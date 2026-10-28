"""Immutable rendered collage records; source and output files remain read-only."""
import copy
import io
import os
from pathlib import Path
from PIL import Image
from fastapi import HTTPException
from sqlalchemy import select,func
from ..config import DATA
from ..models import Session,CollageOutput,now
from .. import collage_output_schemas as schema
from . import collage_service as projects
from .import_service import file_hash

DAMAGED='Collage output is missing or changed. Restore a backup.'
CONFLICT='This collage output request conflicts with a saved output.'

def checked(row):
    try:schema.stored(row.id,row.record,row.assets,row.file_path)
    except (ValueError,TypeError,KeyError):raise HTTPException(409,DAMAGED)
    return copy.deepcopy(row.record)

def get(session,id):
    row=session.get(CollageOutput,id)
    if row is None:raise HTTPException(404,'Collage output not found.')
    checked(row);return row

def file_path(row):
    checked(row);p=Path(row.file_path)
    if not p.is_file() or file_hash(p)!=row.record['sha256']:raise HTTPException(409,DAMAGED)
    return p

def listing(page=1):
    with Session() as session:return {'items':[checked(r) for r in session.scalars(select(CollageOutput).order_by(CollageOutput.created_at.desc(),CollageOutput.id).offset((page-1)*20).limit(20))], 'total':session.scalar(select(func.count()).select_from(CollageOutput))}

def detail(id):
    with Session() as session:
        row=get(session,id);file_path(row)
        for sha,asset in row.assets.items():projects.asset_path(sha,asset)
        return checked(row)

def image_path(id):
    with Session() as session:
        row=get(session,id);return file_path(row),row.record['format']

def source_path(id,source_id):
    with Session() as session:
        row=get(session,id);source=next((s for s in projects.schema.sources(row.record['project']['document']) if s['id']==source_id),None)
        if source is None:raise HTTPException(404,'Collage project source not found.')
        return projects.asset_path(source['sha256'],row.assets[source['sha256']]),source['name']

def save(payload,upload):
    schema.save(payload);upload.file.seek(0);data=upload.file.read(256*1024*1024+1)
    if not data or len(data)>256*1024*1024:raise HTTPException(413,'Collage output exceeds the size limit.')
    import hashlib
    if hashlib.sha256(data).hexdigest()!=payload['sha256']:raise HTTPException(409,DAMAGED)
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.format!={'png':'PNG','jpg':'JPEG','webp':'WEBP'}[payload['format']] or image.width*image.height>100_000_000 or getattr(image,'n_frames',1)!=1:raise ValueError()
            width,height=image.size;image.verify()
    except (OSError,ValueError,SyntaxError,Image.DecompressionBombError) as error:raise HTTPException(422,'Invalid collage output image.') from error
    with projects.lock,Session() as session:
        previous=session.get(CollageOutput,payload['id'])
        if previous:
            record=checked(previous)
            if any(record[k]!=payload[k] for k in ('page','format','quality','sha256')) or record['project']['id']!=payload['project_id'] or record['project']['revision']!=payload['project_revision']:raise HTTPException(409,CONFLICT)
            file_path(previous);return record
        parent=projects.get(session,payload['project_id'])
        if parent.record['revision']!=payload['project_revision']:raise HTTPException(409,projects.CONFLICT)
        record={'version':1,'id':payload['id'],'project':projects.checked(parent),'page':payload['page'],'format':payload['format'],'quality':payload['quality'],'sha256':payload['sha256'],'width':width,'height':height,'created_at':now()}
        schema.record(record)
        for sha,asset in parent.assets.items():projects.asset_path(sha,asset)
        root=DATA/'documents'/'collage-outputs';root.mkdir(parents=True,exist_ok=True);folder=root/payload['id']
        try:folder.mkdir()
        except FileExistsError:raise HTTPException(409,CONFLICT)
        target=folder/(payload['sha256']+'.'+payload['format']);published=False
        try:
            with target.open('xb') as stream:stream.write(data);stream.flush();os.fsync(stream.fileno())
            if file_hash(target)!=payload['sha256']:raise HTTPException(409,DAMAGED)
            session.add(CollageOutput(id=record['id'],record=record,assets=copy.deepcopy(parent.assets),file_path=str(target),created_at=record['created_at']))
            session.commit();published=True;return copy.deepcopy(record)
        finally:
            if not published:
                session.rollback();absent=False
                try:
                    with Session() as check:absent=check.get(CollageOutput,payload['id']) is None
                except Exception:pass
                if absent:
                    target.unlink(missing_ok=True)
                    try:folder.rmdir()
                    except OSError:pass

def remove(id):
    with projects.lock,Session() as session:
        row=get(session,id);session.delete(row);session.commit()
        return {'ok':True} # Immutable files retained; no original or snapshot deletion.
