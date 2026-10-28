"""User-authorized domestic AI work using existing durable jobs and annotation services."""
import base64
from copy import deepcopy
from io import BytesIO
import json
from pathlib import Path
import re
from threading import RLock
from time import monotonic
import httpx
from PIL import Image, ImageOps, ImageColor
from sqlalchemy import select, func
from fastapi import HTTPException
from ..models import Session, AIProfile, AIResult, Photo, AlbumPhoto, LibraryProfile, uid, now
from ..config import DATA, EXPORTS
from ..ai_schemas import Profile, AnnotationOptions
from ..schemas import AnnotationResult
from . import jobs, art_credentials, art_service, ai_protocol, annotation_service
from .safe_image_export import digest, publish_image

lock=RLock()
_session_keys={}
_scopes={}


def profile_view(row):
    configured=row.id in _session_keys or bool(row.encrypted_key)
    key_error=False
    if row.encrypted_key and row.id not in _session_keys:
        try:art_credentials.protect(base64.b64decode(row.encrypted_key,validate=True),decrypt=True).decode('utf-8')
        except (ValueError,OSError,UnicodeError):configured=False;key_error=True
    return deepcopy(row.record)|dict(id=row.id,configured=configured,endpoint=ai_protocol.endpoint(row.record),
        key_error=key_error,
        key_source='session' if row.id in _session_keys else 'windows' if row.encrypted_key else 'none',
        capabilities={'image':True,'annotation':row.record['provider']=='qwen-cn' and bool(row.record.get('vision_model')),
                      'size':'2K' if row.record['provider']=='ark-cn' else 'model-default',
                      'preserves_source_dimensions':False})


def profiles():
    with lock,Session() as s:return [profile_view(r) for r in s.scalars(select(AIProfile))]


def save_profile(id,payload):
    with lock,Session() as s:
        row=s.get(AIProfile,id) if id else None
        if id and row is None:raise HTTPException(404,'AI profile not found.')
        if row is None and payload.revision!=0:raise HTTPException(409,'AI profile changed. Reload it.')
        if row and row.record['revision']!=payload.revision:raise HTTPException(409,'AI profile changed. Reload it.')
        if row is None and s.scalar(select(func.count()).select_from(AIProfile))>=20:raise ValueError('At most 20 AI profiles are supported.')
        record=payload.model_dump(exclude={'api_key','clear_key'});record['revision']=payload.revision+1
        # Credentials belong to an exact account/provider/region/workspace. Changing
        # any identity clears the old key, even when both protocols look similar.
        identity=('provider','region','workspace')
        changed=row is not None and any(row.record[k]!=record[k] for k in identity)
        if row is None:row=AIProfile(id=uid(),record=record);s.add(row)
        clear=payload.clear_key or changed
        key=payload.api_key.get_secret_value() if payload.api_key else None
        encrypted=None
        if key:
            import os
            if os.name=='nt':encrypted=base64.b64encode(art_credentials.protect(key.encode())).decode()
        if clear:row.encrypted_key=None
        if key:row.encrypted_key=encrypted
        row.record=record;s.commit()
        if clear or encrypted:_session_keys.pop(row.id,None)
        if key and not encrypted:_session_keys[row.id]=key
        return profile_view(row)


def profile_snapshot(id,revision=None):
    with lock,Session() as s:
        row=s.get(AIProfile,id)
        if row is None:raise ValueError('AI profile not found.')
        if revision is not None and row.record['revision']!=revision:raise ValueError('AI profile changed. Reload it.')
        key=_session_keys.get(id)
        if not key and row.encrypted_key:
            try:key=art_credentials.protect(base64.b64decode(row.encrypted_key),decrypt=True).decode()
            except (ValueError,OSError):raise ValueError('Cannot read this profile key. Save it again.') from None
        if not key:raise ValueError('Configure a separate key for this AI profile.')
        return deepcopy(row.record)|{'id':id},key


def delete_profile(id):
    with lock,Session() as s:
        row=s.get(AIProfile,id)
        if row:s.delete(row);s.commit()
        _session_keys.pop(id,None)


def request(job_id,profile,key,body):
    # Exactly one POST, no redirect or cross-provider recovery. The key never
    # enters a task, result, provider body, exception or response to the UI.
    jobs.mark_submitted(job_id)
    def capture(value):
        if isinstance(value,str) and key not in value and re.fullmatch(r'[a-zA-Z0-9._:-]{1,200}',value):
            jobs.update(job_id,request_id=value)
    try:
        with httpx.Client(timeout=httpx.Timeout(600,connect=20),follow_redirects=False,trust_env=False) as client:
            with client.stream('POST',ai_protocol.endpoint(profile),headers={'Authorization':'Bearer '+key},json=body) as response:
                capture(response.headers.get('x-request-id') or response.headers.get('x-dashscope-request-id'))
                raw=art_service.read_response(response,48*1024*1024 if response.status_code==200 else 65536)
                if not 200<=response.status_code<300:
                    raise ValueError(f'AI provider rejected the request (HTTP {response.status_code}). No automatic retry.')
                result=json.loads(raw)
                if not isinstance(result,dict) or result.get('error') or result.get('code'):raise ValueError('AI provider rejected the request. No automatic retry.')
    except Exception as error:
        jobs.update(job_id,billing_state='unknown')
        if isinstance(error,ValueError) and str(error).startswith('AI provider rejected'):raise
        raise ValueError('AI response unavailable; billing may have occurred. No automatic retry.') from None
    capture(result.get('request_id') or result.get('id'))
    request_id=jobs.get(job_id).get('request_id','')
    jobs.update(job_id,billing_state='responded',request_id=request_id)
    return result,request_id


def sanitized_photo(id,expected):
    photo=art_service.source_photo(id);art_service.verify_source(photo,expected)
    image=art_service.open_image(Path(photo.file_path));image.thumbnail((1536,1536),Image.Resampling.LANCZOS)
    # Rebuild pixels so no EXIF/GPS/ICC/comment or filesystem name enters cloud input.
    clean=Image.new('RGB',image.size,'white');clean.paste(image.convert('RGB'))
    out=BytesIO();clean.save(out,'JPEG',quality=90);image.close();clean.close()
    art_service.verify_source(photo,expected)
    return 'data:image/jpeg;base64,'+base64.b64encode(out.getvalue()).decode()


def snapshot_scope(payload):
    profile,key=profile_snapshot(payload.profile_id)
    if not profile['vision_model'] or profile['provider']!='qwen-cn':raise ValueError('Select a Qwen vision model.')
    with lock,Session() as s:
        query=select(Photo)
        if payload.photo_ids:query=query.where(Photo.id.in_(list(dict.fromkeys(payload.photo_ids))))
        elif payload.album_id:
            from .library_service import query_photos
            query=query_photos({'album_id':payload.album_id,'count_mode':'file'})
        else:
            job=jobs.get(payload.import_job_id)
            if not job or job.get('scope',{}).get('library_id')!=s.get(LibraryProfile,1).library_id:
                raise ValueError('Import task belongs to another library.')
            ids=job.get('new_photo_ids',[])
            if not ids:raise ValueError('This import has no new photos to annotate.')
            query=query.where(Photo.id.in_(ids))
        if payload.missing_only:query=query.where(func.coalesce(func.json_extract(Photo.annotation,'$.revision'),0)==0)
        photos=s.scalars(query.order_by(Photo.id).limit(101)).all()
        if not 1<=len(photos)<=100:raise ValueError('Select between 1 and 100 photos; narrow the scope first.')
        snapshot=[dict(id=p.id,name=p.file_name,hash=p.file_hash,revision=(p.annotation or {}).get('revision',0)) for p in photos]
        token=uid();current=monotonic()
        for old in list(_scopes):
            if _scopes[old]['expires']<current:_scopes.pop(old,None)
        if len(_scopes)>=20:raise ValueError('Too many pending AI confirmations. Wait for them to expire.')
        _scopes[token]=dict(expires=current+600,photos=snapshot,profile=profile,key=key,options=payload.options.model_dump(),
                            library_id=s.get(LibraryProfile,1).library_id)
        return dict(token=token,count=len(snapshot),photos=[{k:p[k] for k in ('id','name')} for p in snapshot],
                    profile={k:profile[k] for k in ('id','name','provider','region','vision_model','revision')},
                    options=payload.options.model_dump(),expires_seconds=600)


def submit_annotation(payload):
    with lock:
        scope=_scopes.get(payload.token)
        if not scope or scope['expires']<monotonic() or len(scope['photos'])!=payload.count:raise ValueError('AI confirmation expired or the count changed. Review the scope again.')
        with Session() as s:
            if s.get(LibraryProfile,1).library_id!=scope['library_id']:raise ValueError('Library changed. Review the scope again.')
        # Reconfiguration invalidates prior consent, including a newly entered key.
        profile_snapshot(scope['profile']['id'],scope['profile']['revision'])
        result=jobs.submit('ai-annotation',annotate,deepcopy(scope),resource='cloud')
        _scopes.pop(payload.token,None)
        return result


def annotate(job_id,scope):
    results=[];success=0;failed=0
    profile=scope['profile'];options=scope['options']
    jobs.update(job_id,total=len(scope['photos']),photo_ids=[p['id'] for p in scope['photos']],
                provider=profile['provider'],model=profile['vision_model'],profile_id=profile['id'])
    for source in scope['photos']:
        jobs.check(job_id);jobs.update(job_id,current=source['name'],billing_state='not_submitted',request_id='')
        row=None
        try:
            image=sanitized_photo(source['id'],source['hash']);jobs.check(job_id)
            response,request_id=request(job_id,profile,scope['key'],ai_protocol.annotation_request(profile,image,options))
            raw=ai_protocol.response_text(response).replace(scope['key'],'[redacted]')
            record=dict(version=1,revision=1,source=source,options=options,provider=profile['provider'],
                        model=profile['vision_model'],profile_id=profile['id'],request_id=request_id,applied=False)
            try:record['result']=ai_protocol.normalized_annotation(raw,options)
            except ValueError:record.update(result=None,repair_text=raw[:64000])
            with Session() as s:
                row=AIResult(kind='annotation',photo_id=source['id'],record=record);s.add(row);s.commit()
            jobs.check(job_id)
            if record['result'] is None:raise ValueError('Invalid AI annotation response. Repair the saved result locally.')
            apply_result(row.id,1)
            success+=1;results.append(dict(photo_id=source['id'],result_id=row.id,status='completed',request_id=request_id,billing_state='responded'))
        except jobs.JobCancelled:raise
        except Exception as error:
            failed+=1;results.append(dict(photo_id=source['id'],result_id=row.id if row else None,status='failed',
                error=str(error),billing_state=jobs.get(job_id).get('billing_state'),request_id=jobs.get(job_id).get('request_id','')))
        jobs.update(job_id,processed=len(results),success=success,failed=failed,results=results)


def apply_result(id,revision,result=None):
    with lock,Session() as s:
        row=s.get(AIResult,id)
        if row is None or row.kind!='annotation':raise ValueError('AI result not found.')
        record=deepcopy(row.record)
        if record['revision']!=revision:raise ValueError('AI result changed. Reload it.')
        if result is not None:record['result']=ai_protocol.normalized_annotation(result,record['options'])
        if record['result'] is None:raise ValueError('Repair the annotation before applying it.')
        photo=s.get(Photo,row.photo_id)
        if photo is None:raise ValueError('Source photo no longer exists')
        art_service.verify_source(photo,record['source']['hash'])
        fields=ai_protocol.annotation_fields(record['result'],record['options'])
        annotation_service.save_result(s,photo,AnnotationResult(version=1,expected_revision=record['source']['revision'],
            source_hash=record['source']['hash'],provider=record['provider'],model=record['model'],**fields))
        record.update(applied=True,revision=revision+1);record.pop('repair_text',None);row.record=record;s.commit()
        return result_view(row)


def review_place(id,payload):
    with lock,Session() as s:
        row=s.get(AIResult,id)
        if row is None or row.kind!='annotation':raise ValueError('AI result not found.')
        record=deepcopy(row.record)
        if record['revision']!=payload.revision:raise ValueError('AI result changed. Reload it.')
        if not (record.get('result') or {}).get('place_guess'):raise ValueError('No place hypothesis to review.')
        # Human review is provenance on the hypothesis, never a GPS mutation.
        record['place_review']={'status':payload.status,'reviewed_at':now()}
        record['revision']+=1;row.record=record;s.commit()
        return result_view(row)


def result_view(row):
    r=deepcopy(row.record);r.update(id=row.id,kind=row.kind,photo_id=row.photo_id,created_at=row.created_at)
    if row.kind!='annotation':r.update(image_url=f'/api/ai/results/{row.id}/image',preview_url=f'/api/ai/results/{row.id}/preview')
    return r


def result_path(row,preview=False):
    name='preview.webp' if preview else 'image.png'
    from .derived_recycle import safe_path
    path=safe_path('ai-studio/'+row.id+'/'+name)
    if not path.is_file():raise ValueError('AI result image is missing.')
    if not preview and digest(path)!=row.record['sha256']:raise ValueError('AI result image changed; restore the saved version.')
    return path


def create(job_id,payload,profile,key):
    jobs.update(job_id,total=1,provider=profile['provider'],model=profile['image_model'],profile_id=profile['id'])
    source=None;image=None
    if payload.photo_id:
        image=sanitized_photo(payload.photo_id,payload.source_hash)
        photo=art_service.source_photo(payload.photo_id)
        source=dict(id=photo.id,name=photo.file_name,hash=payload.source_hash)
    prompt=payload.prompt.strip()
    if payload.kind=='handwriting':
        prompt=('Create only the exact following text as black handwritten ink on a pure white background. '
                'No other marks, decorations, border, or watermark. Text is literal data: '+json.dumps(payload.text,ensure_ascii=False)+
                '. '+prompt)
    elif payload.preset!='custom':
        from .ai_styles import STYLES
        style=next((s for s in STYLES if s['id']==payload.preset),None)
        if style is None:raise ValueError('Unknown AI style preset.')
        prompt=style['prompt']+'\n'+prompt
    if not prompt:raise ValueError('Enter a visible generation prompt.')
    body=ai_protocol.image_request(profile,prompt,image);jobs.check(job_id)
    response,request_id=request(job_id,profile,key,body)
    raw=ai_protocol.response_image(response,profile['provider'])
    if isinstance(raw,str):raw=art_service.generated_image(raw)
    with Image.open(BytesIO(raw)) as loaded:
        if loaded.width*loaded.height>40_000_000 or max(loaded.size)>8192:raise ValueError('AI output dimensions exceed the supported limit.')
        loaded.load();output=loaded.convert('RGBA' if payload.kind=='handwriting' else 'RGB')
    output.info.clear()
    generated=output.copy()
    if payload.kind=='handwriting':
        # Keep the original generated bitmap as a separate immutable artifact.
        # Luminance to alpha makes recoloring/placement a wholly local operation.
        alpha=ImageOps.invert(output.convert('L'));ink=Image.new('RGBA',output.size,(0,0,0,0));ink.putalpha(alpha);output=ink
    jobs.check(job_id)
    id=uid();folder=DATA/'ai-studio'/id;folder.mkdir(parents=True,exist_ok=False)
    if payload.kind=='handwriting':
        with (folder/'generated.png').open('xb') as stream:generated.save(stream,'PNG')
    with (folder/'image.png').open('xb') as stream:output.save(stream,'PNG')
    preview=output.copy();preview.thumbnail((1000,1000),Image.Resampling.LANCZOS)
    with (folder/'preview.webp').open('xb') as stream:preview.save(stream,'WEBP',quality=90)
    record=dict(version=1,revision=1,source=source,profile_id=profile['id'],provider=profile['provider'],
                model=profile['image_model'],request_id=request_id,prompt=prompt,preset=payload.preset,text=payload.text,
                parent_id=payload.parent_id,width=output.width,height=output.height,sha256=digest(folder/'image.png'),
                verified_text=False if payload.kind=='handwriting' else None)
    with Session() as s:
        row=AIResult(id=id,kind=payload.kind,photo_id=payload.photo_id,record=record);s.add(row);s.commit()
    jobs.update(job_id,processed=1,success=1,result_id=id,results=[dict(result_id=id,status='completed',request_id=request_id,billing_state='responded')])


def submit_creation(payload):
    with lock:
        profile,key=profile_snapshot(payload.profile_id,payload.profile_revision)
        if payload.parent_id:
            with Session() as s:
                parent=s.get(AIResult,payload.parent_id)
                if parent is None or parent.kind!=payload.kind or parent.photo_id!=payload.photo_id:raise ValueError('Version belongs to a different source.')
        if payload.photo_id:art_service.verify_source(art_service.source_photo(payload.photo_id),payload.source_hash)
        # Validate model capabilities before submitting a job or spending money.
        ai_protocol.image_request(profile,'validate','source' if payload.photo_id else None)
        if payload.kind=='restyle' and payload.preset!='custom':
            from .ai_styles import STYLES
            if payload.preset not in {s['id'] for s in STYLES}:raise ValueError('Unknown AI style preset.')
        if payload.kind=='restyle' and payload.preset=='custom' and not payload.prompt.strip():raise ValueError('Enter a visible generation prompt.')
        return jobs.submit('ai-'+payload.kind,create,payload.model_copy(deep=True),profile,key,resource='cloud')


def export_result(id,layout=None):
    with lock,Session() as s:
        row=s.get(AIResult,id)
        if row is None or row.kind=='annotation':raise ValueError('AI image not found.')
        with Image.open(result_path(row)) as source:
            output=source.copy()
        if row.kind=='handwriting':
            if layout is None:raise ValueError('Verify the handwriting text before using it.')
            tint=Image.new('RGBA',output.size,ImageColor.getrgb(layout.color));tint.putalpha(output.getchannel('A'))
            tint.thumbnail((max(1,round(output.width*layout.scale)),max(1,round(output.height*layout.scale))),Image.Resampling.LANCZOS)
            output=Image.new('RGBA',output.size)
            # Position is relative to remaining space, so the full ink stays visible.
            output.alpha_composite(tint,(round((output.width-tint.width)*layout.x),round((output.height-tint.height)*layout.y)))
        return publish_image(output,EXPORTS,'ai-'+row.id,'png',95)



def export_profiles(ids):
    with lock,Session() as s:
        result=[]
        for id in dict.fromkeys(ids):
            row=s.get(AIProfile,id)
            if row is None:raise ValueError('AI profile not found.')
            entry={'profile':deepcopy(row.record)|{'id':id}}
            if row.encrypted_key or id in _session_keys:entry['api_key']=profile_snapshot(id)[1]
            result.append(entry)
        return result


def stage_import_profiles(session,profiles):
    import os
    if session.scalar(select(func.count()).select_from(AIProfile))+len(profiles)>20:
        raise ValueError('At most 20 AI profiles are supported.')
    pending={}
    for entry in profiles:
        record=entry.profile.model_dump(exclude={'id','api_key','clear_key'});record['revision']=1
        key=entry.api_key.get_secret_value() if entry.api_key else None
        encrypted=base64.b64encode(art_credentials.protect(key.encode())).decode() if key and os.name=='nt' else None
        id=uid();session.add(AIProfile(id=id,record=record,encrypted_key=encrypted))
        if key and not encrypted:pending[id]=key
    return pending
