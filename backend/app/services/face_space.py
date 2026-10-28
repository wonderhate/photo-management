"""Versioned local face-vector contracts, independent of a person's identity."""
import hashlib
import json
import math

MODEL='opencv-yunet-sface-v1'
DIMENSIONS=128
PIPELINE='opencv-aligncrop-rgb-bgr-1200-l2-float32-v1'
LEGACY_SPACE='legacy-unverified'
FILES={
    'face_detection_yunet_2023mar.onnx': ('face_detection_yunet','8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4'),
    'face_recognition_sface_2021dec.onnx': ('face_recognition_sface','0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79'),
}

def contract():
    return dict(version=1,engine=MODEL,pipeline=PIPELINE,dimensions=DIMENSIONS,
        detector_sha256=FILES['face_detection_yunet_2023mar.onnx'][1],recognizer_sha256=FILES['face_recognition_sface_2021dec.onnx'][1])

def identity(manifest):
    if not isinstance(manifest,dict) or set(manifest)!={'version','engine','pipeline','dimensions','detector_sha256','recognizer_sha256'} or type(manifest['version']) is not int or manifest['version']!=1 or type(manifest['dimensions']) is not int or not 1<=manifest['dimensions']<=4096:raise ValueError('Invalid face model space.')
    for key in ('engine','pipeline'):
        if not isinstance(manifest[key],str) or not 1<=len(manifest[key])<=160 or any(ord(c)<32 or 0xd800<=ord(c)<=0xdfff for c in manifest[key]):raise ValueError('Invalid face model space.')
    for key in ('detector_sha256','recognizer_sha256'):
        if not isinstance(manifest[key],str) or len(manifest[key])!=64 or any(c not in '0123456789abcdef' for c in manifest[key]):raise ValueError('Invalid face model space.')
    return 'face-'+hashlib.sha256(json.dumps(manifest,sort_keys=True,separators=(',',':')).encode()).hexdigest()

def vector(value,dimensions):
    import numpy as np
    try:
        if isinstance(value,str):
            if len(value)!=dimensions*8:raise ValueError
            value=bytes.fromhex(value)
        if not isinstance(value,bytes) or len(value)!=dimensions*4:raise ValueError
        result=np.frombuffer(value,dtype='<f4').copy()
        if not np.all(np.isfinite(result)):raise ValueError
        norm=float(np.linalg.norm(result.astype('float64')))
        if not math.isfinite(norm) or norm<1e-8:raise ValueError
        return (result/norm).astype('<f4')
    except (ValueError,TypeError,OverflowError):raise ValueError('Invalid face embedding.') from None

def observation(value,dimensions):
    if not isinstance(value,dict) or set(value)!={'encoding','location'}:raise ValueError('Invalid face observation.')
    bbox=value['location']
    if not isinstance(bbox,dict) or set(bbox)!={'left','top','right','bottom'} or any(type(v) not in (int,float) or not math.isfinite(v) or not 0<=v<=1 for v in bbox.values()) or bbox['left']>=bbox['right'] or bbox['top']>=bbox['bottom']:raise ValueError('Invalid face observation.')
    return dict(encoding=vector(value['encoding'],dimensions).tobytes(),location=dict(bbox))

def register(session,manifest):
    from ..models import FaceModelSpace
    key=identity(manifest);existing=session.get(FaceModelSpace,key)
    if existing and (existing.manifest!=manifest or not existing.verified):raise ValueError('Invalid face model space.')
    if not existing:session.add(FaceModelSpace(id=key,manifest=manifest,verified=True));session.flush()
    return key

def prototype(session,person,space,encoding):
    from ..models import FaceModelSpace,FacePrototype
    model=session.get(FaceModelSpace,space)
    if not model:raise ValueError('Invalid face model space.')
    if space==LEGACY_SPACE:return
    if not model.verified or identity(model.manifest)!=space:raise ValueError('Invalid face model space.')
    dimension=model.manifest.get('dimensions',0);value=vector(encoding,dimension).tobytes()
    if not session.get(FacePrototype,(person.id,space)):
        session.add(FacePrototype(person_id=person.id,model_space=space,encoding=value,dimensions=dimension))
    if person.representative_encoding is None:person.representative_encoding=value

def refresh_prototype(session,person_id,space):
    from sqlalchemy import select
    from ..models import FaceModelSpace,FacePrototype,DetectedFace
    if not person_id or space==LEGACY_SPACE:return
    model=session.get(FaceModelSpace,space)
    if not model or not model.verified:return
    session.flush();saved=session.get(FacePrototype,(person_id,space))
    for face in session.scalars(select(DetectedFace).where(DetectedFace.person_id==person_id,DetectedFace.model_space==space).order_by(DetectedFace.confirmed.desc(),DetectedFace.id)):
        try:value=vector(face.encoding,model.manifest['dimensions']).tobytes()
        except ValueError:continue
        if saved:saved.encoding=value
        else:session.add(FacePrototype(person_id=person_id,model_space=space,encoding=value,dimensions=model.manifest['dimensions']))
        return
    if saved:session.delete(saved)
