"""Explicit local indexing and suggestions; this service never edits photos."""
from pathlib import Path
import re
from threading import RLock
from sqlalchemy import select
from ..models import Session,Photo,CaptureGroup,VisualFingerprint
from . import jobs,library_service
from .embedding_space import file_hash,source_signature
from .thumbnail_service import open_image
from .visual_hash import ENGINE,fingerprint,HashIndex,valid_record

_lock=RLock()
_index=None
_key=None
_job=None


def eligible(photo,record):
    if not valid_record(record):return False
    try:
        return (record.get('engine')==ENGINE and record.get('source_hash')==photo.file_hash
                and record.get('source_signature')==source_signature(photo.file_path)
                and record.get('preview_signature')==source_signature(photo.preview_path)
                and bool(re.fullmatch('[a-f0-9]{16}',record.get('phash',''))))
    except (OSError,TypeError):return False


def index_library(job_id):
    with Session() as session:
        photos=session.scalars(select(Photo).join(CaptureGroup,CaptureGroup.preferred_photo_id==Photo.id).order_by(Photo.id)).all()
        saved={item.photo_id:item.record for item in session.scalars(select(VisualFingerprint))}
    jobs.update(job_id,total=len(photos));success=skipped=failed=0;errors=[]
    for offset,photo in enumerate(photos):
        jobs.check(job_id);jobs.update(job_id,current=photo.file_name)
        try:
            if eligible(photo,saved.get(photo.id,{})):skipped+=1
            else:
                signature=source_signature(photo.file_path)
                if file_hash(photo.file_path)!=photo.file_hash:raise ValueError('Original changed; rebuild after verifying the library.')
                preview_signature=source_signature(photo.preview_path);preview_hash=file_hash(photo.preview_path)
                with open_image(Path(photo.preview_path)) as image:record=fingerprint(image)
                jobs.check(job_id)
                if (signature!=source_signature(photo.file_path) or file_hash(photo.file_path)!=photo.file_hash
                        or preview_signature!=source_signature(photo.preview_path) or preview_hash!=file_hash(photo.preview_path)):
                    raise ValueError('Photo changed during appearance analysis.')
                record.update(source_hash=photo.file_hash,source_signature=signature,preview_hash=preview_hash,preview_signature=preview_signature)
                with Session() as session:
                    current=session.get(Photo,photo.id)
                    if current and current.file_hash==photo.file_hash and current.preview_path==photo.preview_path:
                        session.merge(VisualFingerprint(photo_id=photo.id,record=record));session.commit();success+=1
                    else:skipped+=1
        except jobs.JobCancelled:raise
        except Exception:
            failed+=1
            if len(errors)<20:errors.append(photo.file_name+': '+ 'Appearance analysis failed. Check the original and its preview.')
        jobs.update(job_id,processed=offset+1,success=success,skipped=skipped,failed=failed,errors=errors)


def start_index():
    global _job
    with _lock:
        current=jobs.get(_job) if _job else None
        if current and current['status'] in jobs.ACTIVE:return current
        result=jobs.submit('appearance-index',index_library,resource='render');_job=result['id'];return result


def snapshot():
    with Session() as session:
        rows=session.execute(select(Photo,VisualFingerprint).join(CaptureGroup,CaptureGroup.preferred_photo_id==Photo.id).join(VisualFingerprint,VisualFingerprint.photo_id==Photo.id)).all()
    return {p.id:(p,item.record) for p,item in rows if eligible(p,item.record)}


def tree(rows):
    global _index,_key
    key=tuple((identifier,record['phash'],record['source_hash']) for identifier,(_,record) in sorted(rows.items()))
    with _lock:
        if key!=_key:_index=HashIndex((identifier,record['phash']) for identifier,(_,record) in rows.items());_key=key
        return _index


def groups(after='',distance=6,limit=12):
    if type(limit) is not int or not 1<=limit<=20:raise ValueError('Invalid similarity result limit.')
    rows=snapshot();index=tree(rows);ids=[identifier for identifier in sorted(rows) if identifier>after]
    found=[];cursor=after
    # Bound sparse-library scans. The cursor advances even on an empty page.
    for identifier in ids[:300]:
        cursor=identifier
        neighbors=[(delta,other) for delta,other in index.candidates(rows[identifier][1]['phash'],distance) if other>identifier]
        if neighbors:found.append((identifier,neighbors[:8],len(neighbors)))
        if len(found)>=limit:break
    selected={identifier for identifier,_,_ in found}|{other for _,neighbors,_ in found for _,other in neighbors}
    with Session() as session:records={p['id']:p for p in library_service.serialize(session,[rows[identifier][0] for identifier in sorted(selected)])}
    return dict(indexed=len(rows),next_cursor=cursor,has_more=bool(ids and cursor<ids[-1]),groups=[
        dict(source=records[identifier],candidate_count=count,low_information=rows[identifier][1]['contrast']<2,
             candidates=[records[other]|{'appearance_distance':delta} for delta,other in neighbors]) for identifier,neighbors,count in found])


def appearance(photo_id,distance=6,maximum=60,verify=False,clip_threshold=.9):
    if type(maximum) is not int or not 1<=maximum<=200:raise ValueError('Invalid similarity result limit.')
    rows=snapshot()
    with Session() as session:
        source=session.get(Photo,photo_id)
        if source is None:raise ValueError('Photo record no longer exists.')
        group=session.get(CaptureGroup,source.capture_group_id);preferred=group.preferred_photo_id
    if preferred not in rows:raise ValueError('Build the local appearance index before searching this photo.')
    candidates=[(delta,identifier) for delta,identifier in tree(rows).candidates(rows[preferred][1]['phash'],distance) if identifier!=preferred]
    scores={}
    if verify:
        from .embedding_service import service
        scores={item['photo_id']:item['similarity_score'] for item in service.image_similar(preferred,clip_threshold,None)}
        candidates=[pair for pair in candidates if pair[1] in scores]
    candidates=candidates[:maximum]
    with Session() as session:
        records={p['id']:p for p in library_service.serialize(session,[rows[identifier][0] for _,identifier in candidates])}
    return dict(mode='appearance',engine=ENGINE,distance=distance,indexed=len(rows),verified_with_clip=verify,
                low_information=rows[preferred][1]['contrast']<2,source_id=preferred,
                candidates=[records[identifier]|{'appearance_distance':delta,**({'similarity_score':scores[identifier]} if verify else {})} for delta,identifier in candidates])
