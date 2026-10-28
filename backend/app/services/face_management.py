"""Transactional person edits and guarded, library-local undo. Never writes images."""
import hashlib
import json
import zlib
from fastapi import HTTPException
from sqlalchemy import select,delete,or_,text
from ..models import (Session,FacePerson,DetectedFace,FacePrototype,FaceModelSpace,
    FaceCover,FaceMerge,FaceIgnore,FaceIgnoredMember,FaceOperation,Photo,Album,LibraryProfile,uid,now)
from . import face_space
from .face_graph import root,descendants
from .face_ignore import valid_box,member

MAX_STATE=32*1024*1024
MAX_COMPRESSED=8*1024*1024
CONFLICT='人物分组已改变，请刷新后重新检查；未覆盖后续修改'

def canonical(value):
    return json.dumps(value,ensure_ascii=True,sort_keys=True,separators=(',',':')).encode()

def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()

def merge_map(session):
    return dict(session.execute(select(FaceMerge.source_id,FaceMerge.target_id)).all())

def active_person(session,person_id,allow_ignored=False):
    person=session.get(FacePerson,person_id)
    if not person:raise HTTPException(404,'人物不存在')
    if session.get(FaceMerge,person_id):raise HTTPException(409,CONFLICT)
    if not allow_ignored and session.get(FaceIgnore,person_id):raise HTTPException(409,'请先恢复已忽略的人物组')
    return person

def immutable(face,photo):
    return digest([face.id,face.photo_id,face.face_index,face.encoding.hex(),face.location,
        face.model_space,photo.file_hash,photo.capture_group_id])

def face_version(face,photo):
    return digest([immutable(face,photo),face.person_id,face.confirmed])

def context(session,ids,extra=(),created=()):
    return dict(people=descendants(set(ids),merge_map(session)),faces=sorted(set(extra)),created=sorted(created))

def snapshot(session,scope):
    session.flush();session.expire_all()
    ids=descendants(set(scope['people']),merge_map(session))
    people=[dict(id=p.id,name=p.name,representative=p.representative_encoding.hex() if p.representative_encoding is not None else None,
        created_at=p.created_at) for p in session.scalars(select(FacePerson).where(FacePerson.id.in_(ids)).order_by(FacePerson.id))]
    faces=[dict(id=f.id,person_id=f.person_id,confirmed=f.confirmed,model_space=f.model_space,signature=immutable(f,p))
        for f,p in session.execute(select(DetectedFace,Photo).join(Photo).where(or_(DetectedFace.person_id.in_(ids),DetectedFace.id.in_(scope['faces']))).order_by(DetectedFace.id))]
    prototypes=[dict(person_id=p.person_id,model_space=p.model_space,encoding=p.encoding.hex(),dimensions=p.dimensions,created_at=p.created_at)
        for p in session.scalars(select(FacePrototype).where(FacePrototype.person_id.in_(ids)).order_by(FacePrototype.person_id,FacePrototype.model_space))]
    ignored=[dict(person_id=p.person_id,created_at=p.created_at) for p in session.scalars(select(FaceIgnore).where(FaceIgnore.person_id.in_(ids)).order_by(FaceIgnore.person_id))]
    members=[dict(person_id=m.person_id,observation_key=m.observation_key,source_hash=m.source_hash,model_space=m.model_space,encoding=m.encoding.hex(),location=m.location,confirmed=m.confirmed,created_at=m.created_at)
        for m in session.scalars(select(FaceIgnoredMember).where(FaceIgnoredMember.person_id.in_(ids)).order_by(FaceIgnoredMember.person_id,FaceIgnoredMember.observation_key))]
    spaces=sorted({p['model_space'] for p in prototypes}|{f['model_space'] for f in faces}|{m['model_space'] for m in members}|set(scope.get('models',[])))
    state=dict(version=1,people=people,faces=faces,prototypes=prototypes,
        models=[dict(id=m.id,manifest=m.manifest,verified=m.verified) for m in session.scalars(select(FaceModelSpace).where(FaceModelSpace.id.in_(spaces)).order_by(FaceModelSpace.id))],
        covers=[dict(person_id=c.person_id,face_id=c.face_id) for c in session.scalars(select(FaceCover).where(FaceCover.person_id.in_(ids)).order_by(FaceCover.person_id))],
        merges=[dict(source_id=m.source_id,target_id=m.target_id) for m in session.scalars(select(FaceMerge).where(or_(FaceMerge.source_id.in_(ids),FaceMerge.target_id.in_(ids))).order_by(FaceMerge.source_id))],
        album_guard=[list(row) for row in session.execute(select(Album.id,Album.person_id).where(Album.person_id.in_(scope['created'])).order_by(Album.id))])
    # Preserve the exact digest of schema-13 history when no ignore decision exists.
    if ignored or members:state.update(ignores=ignored,ignored_members=members)
    return state

def revision(session,person_id):
    return digest(snapshot(session,context(session,[person_id])))

def check_revision(session,person_id,expected):
    active_person(session,person_id)
    if revision(session,person_id)!=expected:raise HTTPException(409,CONFLICT)

def record(session,kind,scope,before):
    after=snapshot(session,scope)
    if after==before:return {'ok':True,'operation_id':None}
    packed=[]
    for state in (before,after):
        raw=canonical(state)
        if len(raw)>MAX_STATE:raise HTTPException(400,'本次人物整理范围过大，请分批操作')
        data=zlib.compress(raw)
        if len(data)>MAX_COMPRESSED:raise HTTPException(400,'本次人物整理范围过大，请分批操作')
        packed.append(data)
    event=FaceOperation(library_id=session.get(LibraryProfile,1).library_id,kind=kind,context=scope,
        before_state=packed[0],after_hash=digest(after))
    session.add(event);session.flush()
    # Bounded private metadata; never retain image data in the undo log.
    history=session.scalars(select(FaceOperation).order_by(FaceOperation.created_at.desc(),FaceOperation.id.desc())).all()
    size=0
    for index,item in enumerate(history):
        size+=len(item.before_state)
        if index>=100 or size>128*1024*1024:session.delete(item)
    session.commit()
    return {'ok':True,'operation_id':event.id}

def cover(session,person_id):
    saved=session.get(FaceCover,person_id)
    if saved:
        face=session.get(DetectedFace,saved.face_id)
        if face and face.person_id==person_id and valid_box(face.location):return face.id,True
    # Skip malformed legacy detections rather than displaying a broken crop.
    for face in session.scalars(select(DetectedFace).where(DetectedFace.person_id==person_id).order_by(DetectedFace.confirmed.desc(),DetectedFace.id)):
        if valid_box(face.location):return face.id,False
    return None,False

def set_cover(person_id,face_id,expected):
    with Session() as session:
        session.execute(text('BEGIN IMMEDIATE'));check_revision(session,person_id,expected)
        if face_id:
            face=session.get(DetectedFace,face_id)
            if not face or face.person_id!=person_id or not valid_box(face.location):raise HTTPException(400,'请选择该人物的有效人脸作为封面')
        scope=context(session,[person_id]);before=snapshot(session,scope)
        session.execute(delete(FaceCover).where(FaceCover.person_id==person_id))
        if face_id:session.add(FaceCover(person_id=person_id,face_id=face_id))
        return record(session,'cover',scope,before)

def clear_invalid_covers(session,ids):
    session.flush()
    for saved in session.scalars(select(FaceCover).where(FaceCover.person_id.in_(ids))):
        face=session.get(DetectedFace,saved.face_id)
        if not face or face.person_id!=saved.person_id:session.delete(saved)

def move_faces(versions,*,person_id=None,name=None,legacy=False):
    with Session() as session:
        session.execute(text('BEGIN IMMEDIATE'))
        if person_id:active_person(session,person_id)
        faces=[]
        for face_id,expected in versions.items():
            face=session.get(DetectedFace,face_id)
            if not face:raise HTTPException(404,'人脸不存在')
            if face.person_id:active_person(session,face.person_id)
            if not legacy or expected is not None:
                if expected!=face_version(face,session.get(Photo,face.photo_id)):raise HTTPException(409,CONFLICT)
            faces.append(face)
        if name is not None:
            name=name.strip()
            if not name or len(name)>120:raise HTTPException(400,'人物名称不能为空')
            if session.scalar(select(FacePerson.id).where(FacePerson.name==name)):raise HTTPException(409,'人物名称已存在')
            person_id=uid()
        ids={f.person_id for f in faces if f.person_id}
        if person_id:ids.add(person_id)
        scope=context(session,ids,versions,created=[person_id] if name is not None else [])
        before=snapshot(session,scope)
        if name is not None:session.add(FacePerson(id=person_id,name=name));session.flush()
        person=session.get(FacePerson,person_id) if person_id else None
        spaces={(f.person_id,f.model_space) for f in faces}
        for face in faces:
            if person:face_space.prototype(session,person,face.model_space,face.encoding)
            face.person_id=person_id;face.confirmed=bool(person_id)
            spaces.add((person_id,face.model_space))
        session.flush();clear_invalid_covers(session,ids)
        for owner,space in sorted(spaces,key=lambda row:(row[0] or '',row[1])):face_space.refresh_prototype(session,owner,space)
        result=record(session,'split' if name is not None else 'assign' if person_id else 'unlink',scope,before)
        return result|{'person_id':person_id}

def merge(source_ids,target_id,revisions):
    sources=sorted(set(source_ids))
    if target_id in sources:raise HTTPException(400,'不能将人物合并到自身')
    with Session() as session:
        session.execute(text('BEGIN IMMEDIATE'))
        for person_id in sources+[target_id]:check_revision(session,person_id,revisions.get(person_id))
        scope=context(session,sources+[target_id]);before=snapshot(session,scope)
        # A human can join identities across engines. References stay in their own spaces.
        for proto in session.scalars(select(FacePrototype).where(FacePrototype.person_id.in_(sources))):
            if not session.get(FacePrototype,(target_id,proto.model_space)):
                session.add(FacePrototype(person_id=target_id,model_space=proto.model_space,encoding=proto.encoding,dimensions=proto.dimensions,created_at=proto.created_at));session.flush()
            session.delete(proto)
        for face in session.scalars(select(DetectedFace).where(DetectedFace.person_id.in_(sources))):face.person_id=target_id
        for source in sources:session.add(FaceMerge(source_id=source,target_id=target_id))
        session.flush();clear_invalid_covers(session,sources)
        # Source names/IDs and every album member, order and link remain unchanged.
        return record(session,'merge',scope,before)

def history(page=1):
    with Session() as session:
        items=session.scalars(select(FaceOperation).where(FaceOperation.library_id==session.get(LibraryProfile,1).library_id).order_by(FaceOperation.created_at.desc(),FaceOperation.id.desc()).offset((page-1)*20).limit(21)).all()
        return {'items':[dict(id=h.id,kind=h.kind,created_at=h.created_at,undone=bool(h.undone_at)) for h in items[:20]],'has_more':len(items)>20}

def decide(revisions,ignored):
    with Session() as session:
        session.execute(text('BEGIN IMMEDIATE'))
        for person_id,expected in revisions.items():
            active_person(session,person_id,allow_ignored=True)
            if bool(session.get(FaceIgnore,person_id))==ignored or revision(session,person_id)!=expected:raise HTTPException(409,CONFLICT)
        scope=context(session,revisions)
        before=snapshot(session,scope);scope['models']=[m['id'] for m in before['models']]
        if ignored:
            for person_id in revisions:session.add(FaceIgnore(person_id=person_id))
            session.flush();seen=set()
            for face,photo in session.execute(select(DetectedFace,Photo).join(Photo).where(DetectedFace.person_id.in_(revisions))):
                value=member(face.person_id,photo.file_hash,face.model_space,face.encoding,face.location,face.confirmed,now())
                key=(face.person_id,value['observation_key'])
                if key not in seen:session.add(FaceIgnoredMember(**value));seen.add(key)
        else:session.execute(delete(FaceIgnore).where(FaceIgnore.person_id.in_(revisions)))
        return record(session,'ignore' if ignored else 'restore',scope,before)

def undo(operation_id):
    with Session() as session:
        session.execute(text('BEGIN IMMEDIATE'))
        event=session.get(FaceOperation,operation_id)
        if not event or event.library_id!=session.get(LibraryProfile,1).library_id:raise HTTPException(404,'人物整理记录不存在')
        if event.undone_at:raise HTTPException(409,'该操作已经撤销')
        if digest(snapshot(session,event.context))!=event.after_hash:raise HTTPException(409,CONFLICT)
        try:
            decoder=zlib.decompressobj();raw=decoder.decompress(event.before_state,MAX_STATE+1)
            if len(raw)>MAX_STATE or not decoder.eof or decoder.unused_data:raise ValueError()
            before=json.loads(raw)
            if before['version']!=1:raise ValueError()
        except (ValueError,KeyError,zlib.error) as error:raise HTTPException(400,'人物整理记录损坏，未修改分组') from error
        ids=event.context['people']
        session.execute(delete(FaceIgnore).where(FaceIgnore.person_id.in_(ids)))
        session.execute(delete(FaceCover).where(FaceCover.person_id.in_(ids)))
        session.execute(delete(FaceMerge).where(or_(FaceMerge.source_id.in_(ids),FaceMerge.target_id.in_(ids))))
        session.execute(delete(FacePrototype).where(FacePrototype.person_id.in_(ids)))
        for saved in before['faces']:
            face=session.get(DetectedFace,saved['id'])
            if not face or immutable(face,session.get(Photo,face.photo_id))!=saved['signature']:raise HTTPException(409,CONFLICT)
            face.person_id=saved['person_id'];face.confirmed=saved['confirmed']
        for saved in before['people']:
            person=session.get(FacePerson,saved['id'])
            person.name=saved['name'];person.representative_encoding=bytes.fromhex(saved['representative']) if saved['representative'] is not None else None
        session.flush()
        kept={p['id'] for p in before['people']}
        for person_id in event.context['created']:
            if person_id not in kept:
                person=session.get(FacePerson,person_id)
                if person:session.delete(person)
        session.flush()
        for saved in before['prototypes']:session.add(FacePrototype(**(saved|{'encoding':bytes.fromhex(saved['encoding'])})))
        for saved in before['merges']:session.add(FaceMerge(**saved))
        for saved in before['covers']:session.add(FaceCover(**saved))
        for saved in before.get('ignores',[]):session.add(FaceIgnore(**saved))
        session.flush()
        for saved in before.get('ignored_members',[]):session.add(FaceIgnoredMember(**(saved|{'encoding':bytes.fromhex(saved['encoding'])})))
        session.flush()
        if snapshot(session,event.context)!=before:raise HTTPException(409,CONFLICT)
        event.undone_at=now();session.commit();return {'ok':True}

def delete_person(session,person_id):
    active_person(session,person_id)
    ids=descendants({person_id},merge_map(session))
    for face in session.scalars(select(DetectedFace).where(DetectedFace.person_id.in_(ids))):face.person_id=None;face.confirmed=False
    session.flush()
    session.execute(delete(FacePerson).where(FacePerson.id.in_(ids)))
