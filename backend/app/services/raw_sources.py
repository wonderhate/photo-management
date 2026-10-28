"""Read-only RAW registration and explicit hash-bound source confirmation."""
from datetime import datetime,timezone
import os
from pathlib import Path
from sqlalchemy import select,text
from ..config import RAW_EXTENSIONS,DATA,MODELS,EXPORTS
from ..models import Session,Photo,RegisteredRawSource,PhotoRawRelation
from . import jobs,metadata_service
from .import_service import file_hash
from .raw_source_contract import validate,relation,confirmation,candidate

CONFLICT='RAW source or photo changed. Reload before confirming.'
def stamp():return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')

def paths(values):
    if not isinstance(values,list) or not 1<=len(values)<=20 or any(not isinstance(v,str) or not v for v in values):raise ValueError('Choose a RAW source folder.')
    roots=[]
    for value in values:
        path=Path(value).expanduser()
        if not path.is_absolute() or not path.is_dir():raise ValueError('Choose a RAW source folder.')
        path=path.resolve()
        if any(path==p.resolve() or p.resolve() in path.parents or path in p.resolve().parents for p in (DATA,MODELS,EXPORTS)):raise ValueError('Keep RAW sources outside managed library directories.')
        if path not in roots:roots.append(path)
    return roots

def register(job_id,roots):
    seen=set();processed=success=skipped=failed=0;errors=[]
    def inaccessible(error):raise error
    def files():
        for root in roots:
            for folder,dirs,names in os.walk(root,followlinks=False,onerror=inaccessible):
                jobs.check(job_id);dirs[:]=[d for d in dirs if not (Path(folder)/d).is_symlink() and not (Path(folder)/d).is_junction()]
                for name in names:
                    p=Path(folder)/name
                    if p.suffix.lower() in RAW_EXTENSIONS and not p.is_symlink():yield p
    for path in files():
        jobs.check(job_id);resolved=path.resolve(strict=True)
        if resolved in seen:continue
        seen.add(resolved);jobs.update(job_id,current=path.name,phase='indexing',total=processed+1)
        try:
            digest=file_hash(path,job_id);metadata=metadata_service.extract(path,source_hash=digest)
            jobs.check(job_id)
            if file_hash(path,job_id)!=digest:raise ValueError(CONFLICT)
            record=validate(dict(version=1,id=digest,file_hash=digest,file_name=path.name,file_size=path.stat().st_size,path=str(resolved),source_id=None,
                **{k:metadata.get(k) for k in ('date_taken','camera_make','camera_model','lens_model')},registered_at=stamp()))
            with Session() as session:
                old=session.get(RegisteredRawSource,digest)
                if old and old.record['path']==record['path']:skipped+=1
                else:session.merge(RegisteredRawSource(id=digest,record=record));session.commit();success+=1
        except jobs.JobCancelled:raise
        except Exception:
            failed+=1
            if len(errors)<20:errors.append(path.name+': RAW registration failed; check the file and access permission.')
        processed+=1;jobs.update(job_id,processed=processed,total=processed,success=success,skipped=skipped,failed=failed,errors=errors)

def suggestions(photo_id,search='',page=1,page_size=20):
    if not isinstance(search,str) or len(search)>512 or not 1<=page<=50000 or not 1<=page_size<=100:raise ValueError('Invalid RAW source query.')
    with Session() as session:
        photo=session.get(Photo,photo_id)
        if photo is None:raise ValueError('Photo record no longer exists.')
        saved=session.get(PhotoRawRelation,photo_id);record=saved.record if saved else None
        linked=session.get(RegisteredRawSource,record['raw_id']) if record and record['raw_id'] else None
        def candidates():
            for row in session.scalars(select(RegisteredRawSource).execution_options(yield_per=256)):
                source=row.record
                if source['file_hash']==photo.file_hash or search and search.lower() not in (source['file_name']+' '+source['path']).lower():continue
                yield candidate(photo,source)
        # Bounded page response. A filename search also exposes weak/conflicting
        # candidates; no score can create a relation without confirmation.
        ranked=list(candidates());ranked.sort(key=lambda r:(-r['score'],r['source']['id']))
        total=len(ranked)
        return dict(photo_hash=photo.file_hash,record=record,linked=linked.record if linked else None,candidates=ranked[(page-1)*page_size:page*page_size],total=total,page=page,page_size=page_size)

def confirm(photo_id,value):
    value=confirmation(value)
    with Session() as session:
        photo=session.get(Photo,photo_id)
        if photo is None:raise ValueError('Photo record no longer exists.')
        if photo.is_raw:raise ValueError('Choose an exported image for RAW source association.')
        raw=session.get(RegisteredRawSource,value['raw_id']) if value['raw_id'] else None
        if value['raw_id'] and raw is None:raise ValueError('RAW source record no longer exists.')
        if photo.file_hash!=value['photo_hash'] or raw and raw.id==photo.file_hash:raise ValueError(CONFLICT)
        photo_path=photo.file_path;raw_path=raw.record['path'] if raw else None
    try:
        if raw_path and (file_hash(Path(photo_path))!=value['photo_hash'] or file_hash(Path(raw_path))!=value['raw_id']):raise ValueError(CONFLICT)
    except OSError:raise ValueError('RAW source or exported photo is unavailable. Reconnect the original directory.') from None
    with Session() as session:
        session.execute(text('BEGIN IMMEDIATE'));photo=session.get(Photo,photo_id);old=session.get(PhotoRawRelation,photo_id)
        raw=session.get(RegisteredRawSource,value['raw_id']) if value['raw_id'] else None
        if photo is None or photo.file_hash!=value['photo_hash'] or photo.file_path!=photo_path or (old.record['revision'] if old else 0)!=value['expected_revision'] or raw_path and (raw is None or raw.record['path']!=raw_path):raise ValueError(CONFLICT)
        record=relation(dict(version=1,photo_id=photo_id,photo_hash=photo.file_hash,revision=value['expected_revision']+1,raw_id=value['raw_id'],confirmed_at=stamp()))
        session.merge(PhotoRawRelation(photo_id=photo_id,record=record));session.commit()
        return record
