from fastapi import APIRouter,HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import select,func,update
from .models import Session,Photo,FacePerson,DetectedFace
from .schemas import FaceAnalysisRequest,FaceAssignRequest
from .services import face_service,jobs,library_service

router=APIRouter(prefix='/api/faces')

@router.post('/models',status_code=202)
def models():
    if not face_service.status()['dependency']:raise HTTPException(503,'请安装 backend/requirements-faces.txt 后重启')
    active=next((j for j in jobs.recent() if j['kind']=='face-models' and j['status'] in ('queued','running')),None)
    return active or jobs.submit('face-models',face_service.download_models)

@router.post('/analyze',status_code=202)
def analyze(payload: FaceAnalysisRequest):
    if not face_service.is_available():raise HTTPException(503,'请先下载人脸模型')
    active=next((j for j in jobs.recent() if j['kind']=='faces' and j['status'] in ('queued','running')),None)
    return active or jobs.submit('faces',face_service.analyze,payload.photo_ids,payload.threshold)

@router.get('/review')
def review(person_id: str | None = None, page: int = 1, page_size: int = 40):
    if page<1 or not 1<=page_size<=100:raise ValueError('分页参数不合法')
    q=select(DetectedFace)
    q=q.where(DetectedFace.person_id==person_id) if person_id else q.where(DetectedFace.confirmed.is_(False))
    with Session() as session:
        total=session.scalar(select(func.count()).select_from(q.subquery()))
        faces=session.scalars(q.order_by(DetectedFace.id).offset((page-1)*page_size).limit(page_size)).all()
        return {'total':total,'faces':[{'id':f.id,'photo_id':f.photo_id,'person_id':f.person_id,'confirmed':f.confirmed,'thumbnail_url':f'/api/faces/{f.id}/thumbnail'} for f in faces]}

@router.get('/persons/{person_id}/photos')
def person_photos(person_id: str, page: int = 1, page_size: int = 80):
    if page<1 or not 1<=page_size<=200:raise ValueError('分页参数不合法')
    with Session() as session:
        if not session.get(FacePerson,person_id):raise HTTPException(404,'人物不存在')
        q=library_service.query_photos({'person_id':person_id})
        total=session.scalar(select(func.count()).select_from(q.subquery()))
        photos=session.scalars(q.order_by(Photo.date_taken.desc(),Photo.id).offset((page-1)*page_size).limit(page_size)).all()
        return {'photos':library_service.serialize(session,photos),'total':total}

@router.post('/persons/{person_id}/confirm')
def confirm(person_id: str):
    with Session() as session:
        if not session.get(FacePerson,person_id):raise HTTPException(404,'人物不存在')
        session.execute(update(DetectedFace).where(DetectedFace.person_id==person_id).values(confirmed=True))
        session.commit();return {'ok':True}

@router.patch('/detections/{face_id}')
def assign(face_id: str, payload: FaceAssignRequest):
    with Session() as session:
        face=session.get(DetectedFace,face_id)
        if not face:raise HTTPException(404,'人脸不存在')
        person=session.get(FacePerson,payload.person_id) if payload.person_id else None
        if payload.person_id and not person:raise HTTPException(404,'人物不存在')
        face.person_id=payload.person_id;face.confirmed=bool(payload.person_id)
        if person and not person.representative_encoding:person.representative_encoding=face.encoding
        session.commit();return {'ok':True}

@router.get('/{face_id}/thumbnail')
def thumbnail(face_id: str):
    try:return FileResponse(face_service.thumbnail(face_id))
    except (ValueError,OSError) as error:raise HTTPException(404,str(error)) from error
