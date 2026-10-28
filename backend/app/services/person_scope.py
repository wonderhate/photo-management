"""Read-only live person context; no image paths, vectors or model calls."""
import hashlib
import json
from fastapi import HTTPException
from sqlalchemy import select,text
from ..models import Session,LibraryProfile,FacePerson,FaceMerge,FaceIgnore,DetectedFace,Photo
from .face_graph import root
from . import library_service

def state(person_id,library_id,count_mode='capture'):
    with Session() as session:
        session.execute(text('BEGIN'))
        if session.scalar(select(LibraryProfile.library_id).where(LibraryProfile.singleton==1))!=library_id:
            raise ValueError('Search scope belongs to another library.')
        person=session.execute(select(FacePerson.id,FacePerson.name).where(FacePerson.id==person_id)).one_or_none()
        if not person:raise HTTPException(404,'人物不存在')
        links=dict(session.execute(select(FaceMerge.source_id,FaceMerge.target_id)).all())
        target_id=root(person_id,links);target=None
        if target_id!=person_id:
            target=session.execute(select(FacePerson.id,FacePerson.name).where(FacePerson.id==target_id)).one_or_none()
            if not target:raise ValueError('人物合并关系损坏')
        ignored=bool(session.scalar(select(FaceIgnore.person_id).where(FaceIgnore.person_id==person_id)))
        info=dict(id=person.id,name=person.name,ignored=ignored,merged_into=dict(id=target.id,name=target.name) if target else None)
        revision=hashlib.sha256(json.dumps([1,library_id,count_mode,info],sort_keys=True,ensure_ascii=True).encode())
        pending=0;groups=set()
        rows=select(DetectedFace.id,DetectedFace.photo_id,DetectedFace.confirmed,Photo.capture_group_id).join(Photo).where(DetectedFace.person_id==person_id).order_by(DetectedFace.id)
        for row in session.execute(rows.execution_options(yield_per=512)):
            revision.update(json.dumps(list(row),separators=(',',':')).encode());pending+=not row.confirmed;groups.add(row.capture_group_id)
        # Include preferred IDs and paired file changes using the same query as the gallery.
        photos=library_service.query_photos({'person_id':person_id},count_mode).with_only_columns(Photo.id).order_by(Photo.id)
        total=0
        for photo_id in session.scalars(photos.execution_options(yield_per=512)):
            revision.update(b'\n'+photo_id.encode());total+=1
        return info|dict(library_id=library_id,mode=count_mode,revision=revision.hexdigest(),photo_count=len(groups),pending=pending,total=total)
