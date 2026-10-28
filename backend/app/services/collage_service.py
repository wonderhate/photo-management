"""Revision-checked collage projects with immutable app-owned source snapshots."""
import copy
import hashlib
import json
import os
from pathlib import Path
from threading import RLock
from fastapi import HTTPException
from sqlalchemy import select,func
from ..config import DATA
from ..models import Session,CollageProject,Photo,LibraryProfile,now
from .. import collage_schemas as schema
from .import_service import file_hash

lock=RLock()
CONFLICT='This collage changed in another window. Reopen it before saving.'
DAMAGED='Collage project sources are missing or changed. Restore a backup.'

def checked(row):
    try:
        schema.stored_record(row.id,row.record,row.assets)
    except (ValueError,KeyError,TypeError):raise HTTPException(409,DAMAGED)
    return copy.deepcopy(row.record)

def asset_path(sha,asset,verify=True):
    path=schema.asset_path(sha,asset)
    if verify and (not path.is_file() or file_hash(path)!=sha):raise HTTPException(409,DAMAGED)
    return path

def get(session,project_id):
    row=session.get(CollageProject,project_id)
    if not row:raise HTTPException(404,'Collage project not found.')
    checked(row);return row

def list_projects(page=1,search='',sort='updated',direction='desc'):
    with Session() as session:
        name=CollageProject.record['name'].as_string()
        condition=func.instr(func.lower(name),func.lower(search))>0
        column=func.lower(name) if sort=='name' else CollageProject.updated_at
        order=column.asc() if direction=='asc' else column.desc()
        rows=session.scalars(select(CollageProject).where(condition).order_by(order,CollageProject.id).offset((page-1)*20).limit(20)).all()
        return {'items':[checked(r) for r in rows],'total':session.scalar(select(func.count()).select_from(CollageProject).where(condition))}


def detail(project_id):
    with Session() as session:
        row=get(session,project_id)
        for sha,asset in row.assets.items():asset_path(sha,asset)
        return checked(row)

def source_path(project_id,source_id,revision):
    with Session() as session:
        row=get(session,project_id)
        if row.record['revision']!=revision:raise HTTPException(409,CONFLICT)
        source=next((s for s in schema.sources(row.record['document']) if s['id']==source_id),None)
        if not source:raise HTTPException(404,'Collage project source not found.')
        return asset_path(source['sha256'],row.assets[source['sha256']]),source['name']

def save_project(payload,files):
    schema.save(payload);sources=schema.sources(payload['document'])
    if len(files)!=len(sources):raise HTTPException(422,'Choose every original photo listed in the collage document.')
    with lock,Session() as session:
        previous=session.get(CollageProject,payload['id'])
        if previous:checked(previous)
        if previous and previous.record['request_id']==payload['request_id']:
            if previous.record['document']!=payload['document'] or previous.record['name']!=payload['name'] or previous.record['revision']!=payload['expected_revision']+1:raise HTTPException(409,CONFLICT)
            for sha,asset in previous.assets.items():asset_path(sha,asset)
            return checked(previous)
        if (previous.record['revision'] if previous else 0)!=payload['expected_revision']:raise HTTPException(409,CONFLICT)
        old_assets=previous.assets if previous else {};assets={};folder=None;owned=[];published=False;total=0
        try:
            for source,upload in zip(sources,files):
                sha=source['sha256'];upload.file.seek(0);digest=hashlib.sha256();size=0
                # Hash all submitted bytes even when the existing immutable snapshot can be reused.
                for chunk in iter(lambda:upload.file.read(1024*1024),b''):
                    size+=len(chunk);total+=len(chunk)
                    if size>256*1024*1024 or total>512*1024*1024:raise HTTPException(413,'A collage batch needs 1–240 photos, at most 512 MiB in total.')
                    digest.update(chunk)
                if not size or digest.hexdigest()!=sha:raise HTTPException(409,'Collage sources changed. Reopen the photos.')
                if sha in assets:continue
                if sha in old_assets:asset_path(sha,old_assets[sha]);assets[sha]=copy.deepcopy(old_assets[sha]);continue
                if folder is None:
                    root=(DATA/'documents'/'collages').resolve();root.mkdir(parents=True,exist_ok=True);candidate=root/payload['request_id']
                    try:candidate.mkdir(exist_ok=False)
                    except FileExistsError:raise HTTPException(409,CONFLICT)
                    folder=candidate
                target=folder/(sha+'.bin');upload.file.seek(0)
                with target.open('xb') as stream:
                    owned.append(target)
                    for chunk in iter(lambda:upload.file.read(1024*1024),b''):stream.write(chunk)
                    stream.flush();os.fsync(stream.fileno())
                if file_hash(target)!=sha:raise HTTPException(409,DAMAGED)
                assets[sha]={'path':str(target),'storage_id':payload['request_id']}
            timestamp=now();links=[]
            for source in sources:
                photo=session.get(Photo,source.get('photo_id')) if source.get('photo_id') else None
                if photo and photo.file_hash==source['sha256']:links.append({'source_id':source['id'],'photo_id':photo.id})
            record={'version':1,'id':payload['id'],'request_id':payload['request_id'],'revision':payload['expected_revision']+1,'name':payload['name'],'document':copy.deepcopy(payload['document']),'created_at':previous.record['created_at'] if previous else timestamp,'updated_at':timestamp,'origin_library_id':session.get(LibraryProfile,1).library_id,'photo_links':links}
            schema.record(record)
            if previous:previous.record=record;previous.assets=assets;previous.updated_at=timestamp
            else:session.add(CollageProject(id=record['id'],record=record,assets=assets,updated_at=timestamp))
            session.commit();published=True;return copy.deepcopy(record)
        finally:
            if folder and not published:
                session.rollback()
                # Delete only our new candidate files after verifying the request was not published.
                absent=False
                try:
                    with Session() as check:
                        row=check.get(CollageProject,payload['id']);absent=not row or row.record['request_id']!=payload['request_id']
                except Exception:pass
                if absent:
                    for path in owned:path.unlink(missing_ok=True)
                    try:folder.rmdir()
                    except OSError:pass

def remove_project(project_id,revision):
    with lock,Session() as session:
        row=get(session,project_id)
        if row.record['revision']!=revision:raise HTTPException(409,CONFLICT)
        session.delete(row);session.commit()
        # App-owned snapshots are retained for explicit garbage collection; originals never touched.
        return {'ok':True}
