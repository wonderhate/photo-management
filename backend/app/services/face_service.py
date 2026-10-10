"""Local YuNet/SFace suggestions. A user confirms identity; originals are read-only."""
import hashlib
import importlib.util
import urllib.request
from pathlib import Path
from threading import RLock
import numpy as np
from sqlalchemy import select,func
from ..config import MODELS,DATA
from ..models import Session,Photo,CaptureGroup,FacePerson,DetectedFace,now,uid
from . import jobs
from .thumbnail_service import open_image

MODEL='opencv-yunet-sface-v1'
FILES={
    'face_detection_yunet_2023mar.onnx': ('face_detection_yunet','8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4'),
    'face_recognition_sface_2021dec.onnx': ('face_recognition_sface','0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79'),
}
lock=RLock()
_engines=None

def status() -> dict:
    dependency=bool(importlib.util.find_spec('cv2'))
    cached=all((MODELS/'faces'/name).is_file() for name in FILES)
    return {'available':dependency and cached,'dependency':dependency,'cached':cached,'model':MODEL}

def is_available() -> bool:
    return status()['available']

def download_models(job_id: str) -> None:
    folder=MODELS/'faces';folder.mkdir(parents=True,exist_ok=True)
    jobs.update(job_id,total=len(FILES))
    success=skipped=0
    for index,(name,(subdirectory,expected)) in enumerate(FILES.items(),1):
        jobs.check(job_id);target=folder/name
        if target.is_file() and hashlib.sha256(target.read_bytes()).hexdigest()==expected:
            skipped+=1;jobs.update(job_id,processed=index,skipped=skipped,success=success)
            continue
        temporary=target.with_suffix('.download')
        url=f'https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/{subdirectory}/{name}'
        try:
            digest=hashlib.sha256();size=0
            with urllib.request.urlopen(url,timeout=60) as response,temporary.open('wb') as output:
                while chunk:=response.read(1024*1024):
                    jobs.check(job_id);size+=len(chunk)
                    if size>50*1024*1024:raise ValueError('模型大小超出限制')
                    output.write(chunk);digest.update(chunk)
                    jobs.update(job_id,current=f'{name} · {size//1024} KB')
            if digest.hexdigest()!=expected:raise ValueError('模型完整性校验失败')
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
        success+=1;jobs.update(job_id,processed=index,success=success,skipped=skipped)

def detect_faces(image_path: Path) -> list[dict]:
    global _engines
    if not is_available():raise ValueError('请安装可选 OpenCV 依赖并下载人脸模型')
    import cv2
    with lock:
        if _engines is None:
            detector=cv2.FaceDetectorYN.create(str(MODELS/'faces'/'face_detection_yunet_2023mar.onnx'),'',(320,320),.85,.3,5000)
            recognizer=cv2.FaceRecognizerSF.create(str(MODELS/'faces'/'face_recognition_sface_2021dec.onnx'),'')
            _engines=detector,recognizer
        detector,recognizer=_engines
        image=open_image(image_path).convert('RGB');image.thumbnail((1200,1200))
        frame=np.asarray(image)[:,:,::-1].copy();height,width=frame.shape[:2]
        detector.setInputSize((width,height));_,detections=detector.detect(frame)
        result=[]
        for face in [] if detections is None else detections:
            aligned=recognizer.alignCrop(frame,face)
            vector=recognizer.feature(aligned).flatten().astype('float32')
            vector/=max(float(np.linalg.norm(vector)),1e-8)
            x,y,w,h=map(float,face[:4])
            result.append({'location':{'left':max(0,x/width),'top':max(0,y/height),'right':min(1,(x+w)/width),'bottom':min(1,(y+h)/height)},'encoding':vector.tobytes().hex()})
        return result

def detect_photo(photo_id: str, threshold: float = .45) -> dict:
    with lock,Session() as session:
        photo=session.get(Photo,photo_id)
        if not photo:raise ValueError('照片不存在')
        if photo.face_data and photo.face_data.get('model')==MODEL:
            return {'faces':photo.face_data['count'],'cached':True}
        path=Path(photo.preview_path or photo.file_path)
        if not path.is_file():raise ValueError('原图/预览不可用，请重新定位')
        faces=detect_faces(path)
        people=session.scalars(select(FacePerson).where(FacePerson.representative_encoding.is_not(None))).all()
        for index,face in enumerate(faces):
            encoding=bytes.fromhex(face['encoding']);vector=np.frombuffer(encoding,dtype='float32')
            scores=[(float(np.dot(vector,np.frombuffer(p.representative_encoding,dtype='float32'))),p) for p in people if len(p.representative_encoding)==len(encoding)]
            score,person=max(scores,key=lambda row:row[0]) if scores else (-1,None)
            if score<threshold:
                person=FacePerson(id=uid(),name='待确认人物 '+uid()[:8],representative_encoding=encoding)
                session.add(person);session.flush();people.append(person)
            session.add(DetectedFace(photo_id=photo.id,person_id=person.id,face_index=index,encoding=encoding,location=face['location']))
        photo.face_data={'model':MODEL,'count':len(faces),'detected_at':now()}
        session.commit()
        return {'faces':len(faces),'cached':False}

def analyze(job_id: str, ids: list[str], threshold: float = .45) -> None:
    with Session() as session:
        q=select(Photo.id).join(CaptureGroup,CaptureGroup.preferred_photo_id==Photo.id)
        if ids:q=q.where(Photo.id.in_(ids))
        targets=list(session.scalars(q))
    jobs.update(job_id,total=len(targets));success=skipped=failed=0;errors=[]
    for index,photo_id in enumerate(targets,1):
        jobs.check(job_id);jobs.update(job_id,current=photo_id)
        try:
            result=detect_photo(photo_id,threshold)
            if result['cached']:skipped+=1
            else:success+=1
        except Exception as error:
            failed+=1;errors.append(f'{photo_id}: {error}')
        jobs.update(job_id,processed=index,success=success,skipped=skipped,failed=failed,errors=errors[-100:])

def persons() -> list[dict]:
    with Session() as session:
        people=session.scalars(select(FacePerson).order_by(FacePerson.name)).all()
        counts=dict(session.execute(select(DetectedFace.person_id,func.count(func.distinct(Photo.capture_group_id))).join(Photo,Photo.id==DetectedFace.photo_id).group_by(DetectedFace.person_id)).all())
        pending=dict(session.execute(select(DetectedFace.person_id,func.count()).where(DetectedFace.confirmed.is_(False)).group_by(DetectedFace.person_id)).all())
        return [{'id':p.id,'name':p.name,'photo_count':counts.get(p.id,0),'pending':pending.get(p.id,0)} for p in people]

def thumbnail(face_id: str) -> Path:
    with Session() as session:
        face=session.get(DetectedFace,face_id)
        if not face:raise ValueError('人脸不存在')
        target=DATA/'faces'/f'{face.id}.webp'
        if target.is_file():return target
        photo=session.get(Photo,face.photo_id)
        image=open_image(Path(photo.thumbnail_path or photo.preview_path));width,height=image.size
        bounds=face.location
        image=image.crop((bounds['left']*width,bounds['top']*height,bounds['right']*width,bounds['bottom']*height))
        image.thumbnail((160,160));target.parent.mkdir(exist_ok=True);image.save(target,'WEBP',quality=85)
        return target
