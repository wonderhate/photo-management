"""MCP adapters call the same services as the application, never dynamic code."""
import base64
from io import BytesIO
from pathlib import Path
from time import sleep
from sqlalchemy import select,func
from PIL import Image,ImageOps
from ..models import Session,Photo,Album,AlbumPhoto,FacePerson,now
from .. import runtime_control
from . import jobs,library_service,import_service

APP_TOOLS={'show_in_app','crop_assets','export_assets','add_text','edit_asset','render_collage'}

def public(value):
    """Do not disclose server paths, credential-bearing fields or raw EXIF."""
    if isinstance(value,list):return [public(item) for item in value]
    if isinstance(value,dict):return {k:public(v) for k,v in value.items() if k not in
        ('raw_exif','file_path','source_path','thumbnail_path','preview_path','path','directory','data_dir','models_dir','api_key','token','claim_token','scope_token','authorization','key')}
    return value

def photos(ids):
    with Session() as s:
        rows=s.scalars(select(Photo).where(Photo.id.in_(ids))).all()
        mapping={p.id:p for p in rows}
        if len(mapping)!=len(ids):raise ValueError('One or more photos no longer exist.')
        return [dict(id=mapping[i].id,name=mapping[i].file_name,hash=mapping[i].file_hash,
            updated_at=mapping[i].updated_at,path=mapping[i].file_path) for i in ids]

def assets(ids):
    with Session() as s:
        rows=s.scalars(select(Photo).where(Photo.id.in_(ids))).all()
        return public(library_service.serialize(s,rows))

def read(name,a):
    from .. import main
    if name=='get_catalog_info':
        with Session() as s:return dict(catalog_id=runtime_control.library_id,
            photos=s.scalar(select(func.count()).select_from(Photo)),collections=s.scalar(select(func.count()).select_from(Album)),
            originals_read_only=True,api='MCP 2025-06-18',tool_count=37)
    if name=='get_selection':
        from .mcp_service import selection
        return selection()
    if name=='search_assets':
        filters={k:a[k] for k in ('query','text','count_mode') if k in a}
        q=library_service.query_photos(filters,a['count_mode'])
        with Session() as s:
            total=s.scalar(select(func.count()).select_from(q.subquery()))
            rows=s.scalars(q.order_by(Photo.id).offset((a['page']-1)*a['page_size']).limit(a['page_size'])).all()
            return dict(items=public(library_service.serialize(s,rows)),total=total,page=a['page'])
    if name=='get_asset':return public(main.photo_detail(a['photo_id']))
    if name=='view_assets':
        if len(a['photo_ids'])>4:raise ValueError('View at most four previews per call.')
        output=[]
        with Session() as s:
            for id in a['photo_ids']:
                p=s.get(Photo,id)
                if p is None or not p.thumbnail_path:raise ValueError('Photo preview is unavailable. Generate previews in the app first.')
                # Only managed thumbnails; do not decode huge originals in an MCP read.
                from ..config import DATA
                path=Path(p.thumbnail_path).resolve()
                if not path.is_relative_to((DATA/'thumbnails').resolve()):raise ValueError('Invalid preview path.')
                with Image.open(path) as source:
                    source.thumbnail((a['edge'],a['edge']))
                    im=ImageOps.exif_transpose(source).convert('RGB');im.info.clear()
                    out=BytesIO();im.save(out,'JPEG',quality=78);im.close()
                output.append(dict(type='image',mimeType='image/jpeg',data=base64.b64encode(out.getvalue()).decode()))
        return dict(content=output,photo_ids=a['photo_ids'])
    if name=='list_tags':
        from .tag_service import options
        return options({},a['q'],a['page'],a['page_size'],'name')
    if name=='browse_map':
        from .photo_map import summary
        return summary({},a.get('viewport'))
    if name=='get_job_status':
        result=jobs.get(a['job_id'])
        if not result:raise ValueError('Task not found.')
        return public(result)
    if name=='list_active_jobs':return [j for j in jobs.recent(True) if j['status'] in jobs.ACTIVE]
    if name=='manage_collections':
        if a['action']=='get':return public(main.album_detail(a['collection_id']))
        with Session() as s:
            rows=s.scalars(select(Album).order_by(Album.id).limit(100)).all()
            return dict(items=[main.album_dict(s,row) for row in rows],truncated=s.scalar(select(func.count()).select_from(Album))>100)
    if name=='maintain_library':
        from ..config import storage_paths
        return storage_paths()
    if name=='raw_pairing':
        from .raw_sources import suggestions
        return public(suggestions(a['photo_id'],'',a['page'],20))
    if name in ('list_people','get_person'):
        from .face_service import persons
        items=persons()
        if name=='list_people':return dict(items=items[(a['page']-1)*a['page_size']:a['page']*a['page_size']],total=len(items))
        person=next((p for p in items if p['id']==a['person_id']),None)
        if person is None:raise ValueError('Person no longer exists.')
        from ..face_routes import person_photos
        return dict(person=person,photos=public(person_photos(a['person_id'],1,40)))
    if name=='find_similar':
        from ..similarity_routes import similar
        return public(similar(a['photo_id'],a['mode'],a['distance'],a['limit'],False,.3,.9))
    if name=='list_lookalikes':
        from .similarity_service import groups
        return public(groups(a['after'],a['distance'],a['limit']))
    if name=='get_editor_capabilities':
        from ..editor_schemas import recipe_adapter
        return dict(recipe_schema=recipe_adapter.json_schema(),layer_versions=[1,2],originals_read_only=True,
            renderer='shared app Worker',app_required=sorted(APP_TOOLS),max_batch=100,
            pause='Only unclaimed Agent approval/app requests can pause. Running jobs can only cancel.',
            frame_templates=['frame','ambient'])
    raise ValueError('Unknown read tool.')

def wait_child(root,child):
    """An independent coordinator slot never occupies the child's resource."""
    jobs.update(root,linked_job_id=child['id'])
    while True:
        try:jobs.check(root)
        except jobs.JobCancelled:
            value=jobs.cancel(child['id']) or {}
            jobs.update(root,**{k:value[k] for k in ('billing_state','billing_uncertain','results','processed','success','failed') if k in value})
            raise
        value=jobs.get(child['id'])
        if value is None:raise ValueError('Linked task is unavailable.')
        jobs.update(root,**{k:value[k] for k in ('total','processed','success','skipped','failed','current','results','errors','billing_state','billing_uncertain') if k in value})
        if value['status'] not in jobs.ACTIVE:
            if value['status']=='cancelled':raise jobs.JobCancelled()
            if value['status']!='completed':raise ValueError(value.get('error') or 'Linked task did not finish.')
            return dict(job_id=child['id'],status=value['status'],results=public(value.get('results',[])))
        sleep(.1)

def execute(job_id,name,a):
    from .. import main
    from ..schemas import PhotoUpdate,AlbumRequest,AlbumUpdate,FacePersonRename
    ids=a.get('photo_ids',[])
    jobs.check(job_id)
    if name=='update_assets':
        results=[]
        for id in ids:
            jobs.check(job_id);main.update_photo(id,PhotoUpdate.model_validate(a['patch']));results.append(id)
            jobs.update(job_id,total=len(ids),processed=len(results),success=len(results))
        return dict(updated=results)
    if name=='delete_assets':
        removed=0;seen=set()
        for id in ids:
            jobs.check(job_id)
            with Session() as s:
                p=s.get(Photo,id)
                if p and p.capture_group_id not in seen:
                    if a['scope']=='capture':seen.add(p.capture_group_id)
                    removed+=library_service.remove_photo(s,p,a['scope']=='capture')
        return dict(removed=removed,originals_untouched=True)
    if name=='set_asset_location':
        from ..location_routes import update_location
        return update_location(a['photo_id'],{k:a[k] for k in ('source_hash','expected_revision','operation','value') if k in a})
    if name=='manage_collections':
        id=a.get('collection_id');action=a['action']
        if action=='create':return main.create_album(AlbumRequest(name=a['name'],photo_ids=ids))
        if action=='rename':return main.update_album(id,AlbumUpdate(name=a['name']))
        if action=='delete':return main.album_delete(id)
        with Session() as s:
            album=s.get(Album,id)
            if not album or album.type=='rule':raise ValueError('Choose an existing editable collection.')
            members=list(s.scalars(select(AlbumPhoto.photo_id).where(AlbumPhoto.album_id==id).order_by(AlbumPhoto.position,AlbumPhoto.photo_id)))
            title=album.name
        wanted=list(dict.fromkeys(members+ids)) if action=='add' else [i for i in members if i not in ids]
        return main.replace_album_photos(id,AlbumRequest(name=title,photo_ids=wanted))
    if name=='update_person':return main.rename_face_person(a['person_id'],FacePersonRename(name=a['name']))
    if name=='index_people':
        from . import face_service
        if not face_service.is_available():raise ValueError('Install local face models in the app first.')
        return wait_child(job_id,jobs.submit('faces',face_service.analyze,ids,a['threshold'],resource='local-ai'))
    if name=='index_lookalikes':
        from .similarity_service import start_index
        return wait_child(job_id,start_index())
    if name=='generate_previews':
        def generate(child):
            for n,id in enumerate(ids):
                jobs.check(child);import_service.generate_preview(id,child)
                jobs.update(child,total=len(ids),processed=n+1,success=n+1)
        return wait_child(job_id,jobs.submit('agent-previews',generate,resource='render'))
    if name=='import_directory':
        path=Path(a['path'])
        if not path.is_absolute() or not path.is_dir():raise ValueError('Choose an existing absolute directory.')
        return wait_child(job_id,jobs.submit('import',import_service.import_paths,[str(path.resolve())],a['recursive'],True))
    if name=='raw_pairing':
        from .raw_sources import confirm
        return confirm(a['photo_id'],a['value'])
    if name=='maintain_library':return maintain(job_id,a)
    if name in ('cancel_job','pause_job','resume_job'):
        from .mcp_service import control
        return control(name,a['job_id'],job_id)
    if name=='annotate_assets':
        from . import ai_studio
        from ..ai_schemas import Scope,Authorize
        ai_studio.profile_snapshot(a['profile_id'],a['profile_revision'])
        scope=ai_studio.snapshot_scope(Scope(profile_id=a['profile_id'],photo_ids=ids,options=a['options']))
        jobs.check(job_id)
        return wait_child(job_id,ai_studio.submit_annotation(Authorize(token=scope['token'],count=scope['count'],confirmed=True)))
    if name=='repaint_asset':
        from . import ai_studio
        from ..ai_schemas import Create
        value={k:a[k] for k in ('photo_id','source_hash','profile_id','profile_revision','preset','prompt')}
        return wait_child(job_id,ai_studio.submit_creation(Create(**value,confirmed=True)))
    if name=='apply_frame':
        from ..watermark_drafts import create
        from ..draft_schemas import DraftCreate
        results=[]
        for id in ids:
            jobs.check(job_id);result=create(DraftCreate(photo_id=id,settings_json={'template':a['template']}))
            results.append(dict(id=result['id'],photo_id=id))
        return dict(drafts=results)
    raise ValueError('Unknown write tool.')

def maintain(job_id,a):
    from .. import config
    action=a['action']
    if action in ('add_watched_dir','remove_watched_dir'):
        current=config.storage_paths()['current'];path=Path(a['path'])
        if not path.is_absolute():raise ValueError('Choose an absolute directory.')
        path=str(path.resolve());paths=list(current['scan_paths'])
        if action=='add_watched_dir':
            if not Path(path).is_dir():raise ValueError('Directory is unavailable.')
            paths=list(dict.fromkeys(paths+[path]))
        else:paths=[p for p in paths if Path(p).resolve()!=Path(path)]
        # Existing storage UI applies directory changes after explicit restart.
        return dict(paths=config.save_storage_paths(current|{'scan_paths':paths}),restart_required=True)
    if action=='scan_new_media':
        from .scan_service import start
        result=start(True)
        return wait_child(job_id,result['job']) if result.get('job') else result
    if action=='relink':
        from ..source_routes import relink,Relink
        return relink(a['photo_id'],Relink(path=a['path']))
    records=photos(a['photo_ids']);results=[]
    from . import metadata_service
    from .rating_service import external_rating
    for source in records:
        jobs.check(job_id);path=Path(source['path'])
        digest=import_service.file_hash(path,job_id)
        if digest!=source['hash']:raise ValueError('The source photo changed. Reopen it before saving.')
        if action=='refresh_from_disk':
            data=metadata_service.extract(path,source_hash=digest)
            if data.get('orientation') in (5,6,7,8):data['width'],data['height']=data.get('height'),data.get('width')
            if import_service.file_hash(path,job_id)!=digest:raise ValueError('Source changed during metadata refresh.')
            with Session() as s:
                p=s.get(Photo,source['id'])
                if not p or p.file_hash!=digest or p.updated_at!=source['updated_at']:raise ValueError('Photo changed. Review the request again.')
                for key,value in data.items():setattr(p,key,value)
                if p.rating_source not in ('manual',None):
                    for key,value in external_rating(data['raw_exif']).items():setattr(p,key,value)
                p.updated_at=now();s.commit()
        results.append(dict(id=source['id'],sha256=digest,unchanged=True))
        jobs.update(job_id,total=len(records),processed=len(results),success=len(results))
    return dict(items=results,originals_untouched=True)
