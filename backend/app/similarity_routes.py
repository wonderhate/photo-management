from typing import Literal
from fastapi import APIRouter,Query
from sqlalchemy import select
from .models import Session,Photo,CaptureGroup,VisualFingerprint
from .services import similarity_service,library_service
from .services.embedding_service import service

router=APIRouter(prefix='/api/similarity',tags=['local similarity'])


@router.post('/index',status_code=202)
def index():
    return similarity_service.start_index()


@router.get('/photos/{photo_id}/analysis')
def analysis(photo_id:str):
    with Session() as session:
        source=session.get(Photo,photo_id)
        if source is None:raise ValueError('Photo record no longer exists.')
        group=session.get(CaptureGroup,source.capture_group_id)
        photo=session.get(Photo,group.preferred_photo_id)
        record=session.get(VisualFingerprint,photo.id)
        if record and similarity_service.eligible(photo,record.record):
            return dict(indexed=True,engine=record.record['engine'],palette=record.record['palette'],contrast=record.record['contrast'])
    return dict(indexed=False,palette=[])


@router.get('/groups')
def groups(after:str=Query(default='',max_length=80),distance:int=Query(default=6,ge=0,le=16),limit:int=Query(default=12,ge=1,le=20)):
    return similarity_service.groups(after,distance,limit)


@router.get('/photos/{photo_id}')
def similar(photo_id:str,mode:Literal['appearance','semantic']='appearance',distance:int=Query(default=6,ge=0,le=16),
            limit:int=Query(default=60,ge=1,le=200),verify:bool=False,
            semantic_threshold:float=Query(default=.3,ge=-1,le=1),verification_threshold:float=Query(default=.9,ge=-1,le=1)):
    if mode=='appearance':return similarity_service.appearance(photo_id,distance,limit,verify,verification_threshold)
    matches=service.image_similar(photo_id,semantic_threshold,limit)
    with Session() as session:
        photos=session.scalars(select(Photo).where(Photo.id.in_([item['photo_id'] for item in matches]))).all()
        records={p['id']:p for p in library_service.serialize(session,photos)}
    return dict(mode='semantic',model=service.model_name,model_revision=service.model_revision,
                candidates=[records[item['photo_id']]|{'similarity_score':item['similarity_score']} for item in matches if item['photo_id'] in records])
