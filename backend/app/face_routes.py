from fastapi import APIRouter,HTTPException
from typing import Literal
from fastapi.responses import FileResponse
from sqlalchemy import select,func,update
from .models import Session,Photo,FacePerson,DetectedFace,FaceIgnore
from .schemas import FaceAnalysisRequest,FaceAssignRequest,FaceCoverRequest,FaceMergeRequest,FaceMoveRequest,FaceGroupDecisionRequest,FaceImportPolicy
from .services import face_service,jobs,library_service
from .services import face_space,face_management
from .services import person_scope

router=APIRouter(prefix='/api/faces')

@router.get('/import-policy')
def import_policy():
    from .services import import_face_analysis
    return import_face_analysis.policy()

@router.put('/import-policy')
def put_import_policy(payload: FaceImportPolicy):
    from .services import import_face_analysis
    return import_face_analysis.set_policy(payload.enabled)

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
    q=select(DetectedFace).where((DetectedFace.person_id.is_(None))|(~DetectedFace.person_id.in_(select(FaceIgnore.person_id))))
    q=q.where(DetectedFace.person_id==person_id) if person_id else q.where(DetectedFace.confirmed.is_(False))
    with Session() as session:
        total=session.scalar(select(func.count()).select_from(q.subquery()))
        faces=session.scalars(q.order_by(DetectedFace.id).offset((page-1)*page_size).limit(page_size)).all()
        return {'total':total,'revision':face_management.revision(session,person_id) if person_id else None,
            'faces':[{'id':f.id,'photo_id':f.photo_id,'person_id':f.person_id,'confirmed':f.confirmed,'model_space':f.model_space,'legacy':f.model_space==face_space.LEGACY_SPACE,'thumbnail_url':f'/api/faces/{f.id}/thumbnail',
                'version':face_management.face_version(f,session.get(Photo,f.photo_id))} for f in faces]}

@router.get('/persons/{person_id}/revision')
def person_revision(person_id: str,ignored: bool = False):
    with Session() as session:
        person=face_management.active_person(session,person_id,allow_ignored=ignored)
        if bool(session.get(FaceIgnore,person_id))!=ignored:raise HTTPException(409,face_management.CONFLICT)
        return {'revision':face_management.revision(session,person_id),'name':person.name}

@router.get('/persons/{person_id}/scope')
def person_scope_state(person_id: str,library_id: str,count_mode: Literal['capture','file'] = 'capture'):
    return person_scope.state(person_id,library_id,count_mode)

@router.get('/ignored')
def ignored_groups(page: int = 1,search: str = ''):
    if page<1 or len(search)>256:raise HTTPException(400,'分页或搜索参数不合法')
    return face_service.ignored_people(page,search)

@router.post('/groups/ignore')
def ignore_groups(payload: FaceGroupDecisionRequest):
    return face_management.decide(payload.revisions,True)

@router.post('/groups/restore')
def restore_groups(payload: FaceGroupDecisionRequest):
    return face_management.decide(payload.revisions,False)

@router.patch('/persons/{person_id}/cover')
def set_cover(person_id: str,payload: FaceCoverRequest):
    return face_management.set_cover(person_id,payload.face_id,payload.revision)

@router.post('/merge')
def merge(payload: FaceMergeRequest):
    return face_management.merge(payload.source_ids,payload.target_id,payload.revisions)

@router.post('/split')
def split(payload: FaceMoveRequest):
    if payload.name is None:raise HTTPException(400,'人物名称不能为空')
    return face_management.move_faces(payload.face_versions,name=payload.name)

@router.post('/unlink')
def unlink(payload: FaceMoveRequest):
    return face_management.move_faces(payload.face_versions)

@router.get('/history')
def history(page: int = 1):
    if not 1<=page<=5:raise HTTPException(400,'分页参数不合法')
    return face_management.history(page)

@router.post('/history/{operation_id}/undo')
def undo(operation_id: str):
    return face_management.undo(operation_id)

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
        face_management.active_person(session,person_id)
        session.execute(update(DetectedFace).where(DetectedFace.person_id==person_id).values(confirmed=True))
        session.commit();return {'ok':True}

@router.patch('/detections/{face_id}')
def assign(face_id: str, payload: FaceAssignRequest):
    return face_management.move_faces({face_id:payload.version},person_id=payload.person_id,legacy=True)

@router.get('/{face_id}/thumbnail')
def thumbnail(face_id: str):
    try:return FileResponse(face_service.thumbnail(face_id),media_type='image/webp')
    except (ValueError,OSError) as error:raise HTTPException(404,str(error)) from error
