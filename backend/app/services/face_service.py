"""Local YuNet/SFace suggestions. A user confirms identity; originals are read-only."""
import hashlib
import importlib.util
import urllib.request
from pathlib import Path
from threading import RLock
from collections import defaultdict
import numpy as np
from sqlalchemy import select,func,text
from ..config import MODELS,DATA
from ..models import Session,Photo,CaptureGroup,FacePerson,DetectedFace,FacePrototype,FaceCover,FaceMerge,FaceIgnore,FaceIgnoredMember,Album,AlbumPhoto,now,uid
from . import jobs
from . import face_space,face_ignore
from .thumbnail_service import open_image

MODEL=face_space.MODEL
FILES=face_space.FILES
lock=RLock()
_engines=None
_engine_key=None
_integrity=None
active_contract=face_space.contract

def verified_models():
    global _integrity
    with lock:
        try:
            paths=[MODELS/'faces'/name for name in FILES]
            if not all(p.is_file() for p in paths):return False,'missing',None
            def stamp():return tuple((str(p.resolve()),p.stat().st_size,p.stat().st_mtime_ns,p.stat().st_ctime_ns,p.stat().st_ino) for p in paths)
            key=(tuple(FILES.items()),stamp())
            if _integrity is None or _integrity[0]!=key:
                valid=True
                for p,(_,expected) in zip(paths,FILES.values()):
                    digest=hashlib.sha256()
                    with p.open('rb') as f:
                        while chunk:=f.read(1024*1024):digest.update(chunk)
                    valid=valid and digest.hexdigest()==expected
                if stamp()!=key[1]:return True,'invalid',None
                _integrity=key,valid
            return True,'ready' if _integrity[1] else 'invalid',key
        except OSError:return True,'invalid',None

def status() -> dict:
    dependency=bool(importlib.util.find_spec('cv2'))
    cached,integrity,_=verified_models();manifest=active_contract()
    return {'available':dependency and integrity=='ready','dependency':dependency,'cached':cached,'model':MODEL,
        'integrity':integrity,'local':True,'model_space':face_space.identity(manifest),'dimensions':manifest['dimensions']}

def is_available() -> bool:
    return status()['available']


def try_status():
    """Do not make import/policy requests wait for an active face engine."""
    if not lock.acquire(blocking=False):return None
    try:return status()
    finally:lock.release()

def download_models(job_id: str) -> None:
    global _engines,_engine_key,_integrity
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
            with lock:
                temporary.replace(target);_engines=None;_engine_key=None;_integrity=None
        finally:
            temporary.unlink(missing_ok=True)
        success+=1;jobs.update(job_id,processed=index,success=success,skipped=skipped)

def detect_faces(image_path: Path) -> list[dict]:
    global _engines,_engine_key
    if not is_available():raise ValueError('请安装可选 OpenCV 依赖并下载人脸模型')
    import cv2
    with lock:
        _,integrity,key=verified_models()
        if integrity!='ready':raise ValueError('本地人脸模型校验未通过，请修复模型后再分析')
        if _engines is None or _engine_key!=key:
            detector=cv2.FaceDetectorYN.create(str(MODELS/'faces'/'face_detection_yunet_2023mar.onnx'),'',(320,320),.85,.3,5000)
            recognizer=cv2.FaceRecognizerSF.create(str(MODELS/'faces'/'face_recognition_sface_2021dec.onnx'),'')
            _engines=detector,recognizer
            _engine_key=key
        detector,recognizer=_engines
        image=open_image(image_path).convert('RGB');image.thumbnail((1200,1200))
        frame=np.asarray(image)[:,:,::-1].copy();height,width=frame.shape[:2]
        detector.setInputSize((width,height));_,detections=detector.detect(frame)
        result=[]
        for face in [] if detections is None else detections:
            aligned=recognizer.alignCrop(frame,face)
            vector=face_space.vector(recognizer.feature(aligned).flatten().astype('<f4').tobytes(),active_contract()['dimensions'])
            x,y,w,h=map(float,face[:4])
            item={'location':{'left':max(0,x/width),'top':max(0,y/height),'right':min(1,(x+w)/width),'bottom':min(1,(y+h)/height)},'encoding':vector.tobytes().hex()}
            face_space.observation(item,len(vector));result.append(item)
        if verified_models()[2]!=key:raise ValueError('人脸模型已改变，请重新分析')
        return result

def detect_photo(photo_id: str, threshold: float = .45,check=lambda:None) -> dict:
    if not isinstance(threshold,(int,float)) or isinstance(threshold,bool) or not np.isfinite(threshold) or not .3<=threshold<=.95:raise ValueError('人脸分组相似度无效')
    def cached(session,photo):
        count=session.scalar(select(func.count()).select_from(DetectedFace).where(DetectedFace.photo_id==photo.id))
        if photo.face_data or count:return {'faces':count,'cached':True,'preserved':True}
    with lock:
      with Session() as session:
        photo=session.get(Photo,photo_id)
        if not photo:raise ValueError('照片不存在')
        saved=cached(session,photo)
        if saved:return saved
        path=Path(photo.preview_path or photo.file_path)
        if not path.is_file():raise ValueError('原图/预览不可用，请重新定位')
        source=(photo.file_hash,photo.preview_path,photo.file_path)
      check();manifest=active_contract();space=face_space.identity(manifest)
      faces=[face_space.observation(f,manifest['dimensions']) for f in detect_faces(path)]
      check()
      if active_contract()!=manifest:raise ValueError('人脸模型已改变，请重新分析')
      with Session() as session:
        session.execute(text('BEGIN IMMEDIATE'))
        photo=session.get(Photo,photo_id)
        if not photo:raise ValueError('照片不存在')
        saved=cached(session,photo)
        if saved:return saved
        if (photo.file_hash,photo.preview_path,photo.file_path)!=source:raise ValueError('照片来源已改变，请重新打开照片')
        face_space.register(session,manifest)
        people=[]
        for proto,person in session.execute(select(FacePrototype,FacePerson).join(FacePerson).where(FacePrototype.model_space==space,FacePrototype.dimensions==manifest['dimensions'],~FacePerson.id.in_(select(FaceMerge.source_id)),~FacePerson.id.in_(select(FaceIgnore.person_id))).order_by(FacePrototype.person_id)):
            try:people.append((face_space.vector(proto.encoding,manifest['dimensions']),person))
            except ValueError:continue # Preserve a damaged historical prototype without comparing it.
        ignored=session.scalars(select(FaceIgnoredMember).join(FaceIgnore).where(FaceIgnoredMember.source_hash==photo.file_hash,FaceIgnoredMember.model_space==space,~FaceIgnoredMember.person_id.in_(select(FaceMerge.source_id))).order_by(FaceIgnoredMember.person_id,FaceIgnoredMember.observation_key)).all()
        for index,face in enumerate(faces):
            key=face_ignore.observation_key(photo.file_hash,space,face['encoding'],face['location'])
            rejected=next((r for r in ignored if r.observation_key==key or face_ignore.matches(r,face,manifest['dimensions'])),None)
            if rejected:
                session.add(DetectedFace(photo_id=photo.id,person_id=rejected.person_id,face_index=index,encoding=face['encoding'],location=face['location'],model_space=space,confirmed=rejected.confirmed));continue
            encoding=face['encoding'];vector=face_space.vector(encoding,manifest['dimensions'])
            scores=[(float(np.dot(vector,p)),person) for p,person in people]
            score,person=max(scores,key=lambda row:row[0]) if scores else (-1,None)
            if score<threshold:
                person=FacePerson(id=uid(),name='待确认人物 '+uid()[:8],representative_encoding=encoding)
                session.add(person);session.flush();face_space.prototype(session,person,space,encoding);people.append((vector,person))
            session.add(DetectedFace(photo_id=photo.id,person_id=person.id,face_index=index,encoding=encoding,location=face['location'],model_space=space))
        check();photo.face_data={'model':manifest['engine'],'model_space':space,'dimensions':manifest['dimensions'],'count':len(faces),'source_hash':photo.file_hash,'detected_at':now()}
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
            result=detect_photo(photo_id,threshold,check=lambda:jobs.check(job_id))
            if result['cached']:skipped+=1
            else:success+=1
        except jobs.JobCancelled:raise
        except Exception as error:
            failed+=1;errors.append(f'{photo_id}: {error}')
        jobs.update(job_id,processed=index,success=success,skipped=skipped,failed=failed,errors=errors[-100:])

def persons() -> list[dict]:
    from . import face_management as management
    with Session() as session:
        links=management.merge_map(session)
        people=session.scalars(select(FacePerson).where(~FacePerson.id.in_(select(FaceMerge.source_id)),~FacePerson.id.in_(select(FaceIgnore.person_id))).order_by(FacePerson.name)).all()
        covers={};manual=dict(session.execute(select(FaceCover.person_id,FaceCover.face_id)).all())
        for face_id,owner,bounds in session.execute(select(DetectedFace.id,DetectedFace.person_id,DetectedFace.location).join(Photo,Photo.id==DetectedFace.photo_id).order_by(DetectedFace.confirmed.desc(),DetectedFace.id)):
            if management.valid_box(bounds) and (owner not in covers or manual.get(owner)==face_id):covers[owner]=face_id
        counts=dict(session.execute(select(DetectedFace.person_id,func.count(func.distinct(Photo.capture_group_id))).join(Photo,Photo.id==DetectedFace.photo_id).group_by(DetectedFace.person_id)).all())
        pending=dict(session.execute(select(DetectedFace.person_id,func.count()).join(Photo,Photo.id==DetectedFace.photo_id).where(DetectedFace.confirmed.is_(False)).group_by(DetectedFace.person_id)).all())
        albums=session.scalars(select(Album).where(Album.type=='normal').order_by(Album.created_at.desc(),Album.id)).all()
        linked=defaultdict(list)
        for album in albums:
            if album.person_id:linked[album.person_id].append(album)
        # Older releases saved only album members. Match complete capture sets, not names or RAW/JPG IDs.
        unlinked=[p.id for p in people if not linked[p.id] and not pending.get(p.id,0) and counts.get(p.id,0)]
        person_groups,album_groups=defaultdict(set),defaultdict(set)
        legacy=defaultdict(list)
        if unlinked:
            for person_id,group_id in session.execute(select(DetectedFace.person_id,Photo.capture_group_id).join(Photo,Photo.id==DetectedFace.photo_id).where(DetectedFace.person_id.in_(unlinked),DetectedFace.confirmed.is_(True))):
                person_groups[person_id].add(group_id)
            for album_id,group_id in session.execute(select(AlbumPhoto.album_id,Photo.capture_group_id).join(Photo,Photo.id==AlbumPhoto.photo_id).join(Album,Album.id==AlbumPhoto.album_id).where(Album.type=='normal',Album.person_id.is_(None))):
                album_groups[album_id].add(group_id)
            for album in albums:
                if not album.person_id and album_groups[album.id]:legacy[frozenset(album_groups[album.id])].append(album)
        result=[]
        for p in people:
            choices=[{'id':a.id,'name':a.name,'linked':a.person_id==p.id} for a in (linked[p.id] or [a for a in legacy.get(frozenset(person_groups[p.id]),[]) if a.created_at>=p.created_at])]
            historical=[{'id':a.id,'name':a.name,'linked':False,'historical':True,'source_person_id':a.person_id} for a in albums if a.person_id in links and management.root(a.person_id,links)==p.id]
            face_id=covers.get(p.id)
            result.append({'id':p.id,'name':p.name,'photo_count':counts.get(p.id,0),'pending':pending.get(p.id,0),
                'cover_face_id':face_id,'cover_url':f'/api/faces/{face_id}/thumbnail' if face_id else None,'manual_cover':bool(face_id and manual.get(p.id)==face_id),'albums':choices+historical})
        return result

def ignored_people(page=1,search=''):
    with Session() as session:
        q=select(FacePerson,FaceIgnore).join(FaceIgnore).where(~FacePerson.id.in_(select(FaceMerge.source_id)))
        if search:q=q.where(FacePerson.name.contains(search,autoescape=True))
        total=session.scalar(select(func.count()).select_from(q.subquery()))
        rows=session.execute(q.order_by(FacePerson.name,FacePerson.id).offset((page-1)*40).limit(40)).all()
        ids=[person.id for person,_ in rows]
        counts=dict(session.execute(select(DetectedFace.person_id,func.count(func.distinct(Photo.capture_group_id))).join(Photo,Photo.id==DetectedFace.photo_id).where(DetectedFace.person_id.in_(ids)).group_by(DetectedFace.person_id)).all())
        pending=dict(session.execute(select(DetectedFace.person_id,func.count()).join(Photo,Photo.id==DetectedFace.photo_id).where(DetectedFace.person_id.in_(ids),DetectedFace.confirmed.is_(False)).group_by(DetectedFace.person_id)).all())
        return {'people':[dict(id=p.id,name=p.name,photo_count=counts.get(p.id,0),pending=pending.get(p.id,0),ignored_at=i.created_at) for p,i in rows],
            'total':total,'has_more':page*40<total}

def thumbnail(face_id: str) -> Path:
    with Session() as session:
        face=session.get(DetectedFace,face_id)
        if not face:raise ValueError('人脸不存在')
        target=DATA/'faces'/f'{face.id}.webp'
        if target.is_file():return target
        photo=session.get(Photo,face.photo_id)
        from .face_management import valid_box
        if not photo or not valid_box(face.location):raise ValueError('人脸缩略图不可用')
        source=next((Path(p) for p in (photo.thumbnail_path,photo.preview_path,photo.file_path) if p and Path(p).is_file()),None)
        if source is None:raise ValueError('人脸缩略图不可用')
        image=open_image(source);width,height=image.size
        bounds=face.location
        image=image.crop((bounds['left']*width,bounds['top']*height,bounds['right']*width,bounds['bottom']*height))
        image.thumbnail((160,160));target.parent.mkdir(exist_ok=True);image.save(target,'WEBP',quality=85)
        return target
