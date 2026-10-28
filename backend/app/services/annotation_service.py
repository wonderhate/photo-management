"""Local annotation persistence; this module never sends images or calls models."""
from sqlalchemy import select,delete,update,func
from fastapi import HTTPException
from ..models import Photo,PhotoTag,Tag,now

def tag_names(values):
    return list(dict.fromkeys(v.strip()[:200] for v in values if v.strip()))

def tag_state(session,photo):
    rows=session.execute(select(Tag.name,PhotoTag.origin).join(PhotoTag).where(PhotoTag.photo_id==photo.id)).all()
    return {'tags':[name for name,_ in rows],'tag_origins':dict(rows),'rejected_ai_tags':list(photo.rejected_ai_tags or [])}

def view(photo):
    annotation=photo.annotation or None
    caption=(annotation or {}).get('caption','')
    user=photo.user_description is not None
    return {'description':(photo.user_description if user else caption).strip() or None,
            'description_source':'user' if user else 'ai' if caption else None}

def write_tags(session,photo,state):
    session.execute(delete(PhotoTag).where(PhotoTag.photo_id==photo.id))
    for name in state['tags']:
        tag=session.scalar(select(Tag).where(Tag.name==name))
        if not tag:
            tag=Tag(name=name);session.add(tag);session.flush()
        session.add(PhotoTag(photo_id=photo.id,tag_id=tag.id,origin=state['tag_origins'].get(name,'user')))
    photo.rejected_ai_tags=state['rejected_ai_tags']
    session.flush()

def edit_tags(session,photo,*,names=None,additions=(),removals=(),restore=()):
    state=tag_state(session,photo);tags=state['tags'];origins=state['tag_origins'];rejected=set(state['rejected_ai_tags'])
    def remove(name):
        if name in tags:tags.remove(name)
        origins.pop(name,None);rejected.add(name)
    if names is not None:
        wanted=tag_names(names)
        for old in list(tags):
            if old not in wanted:remove(old)
        tags=wanted
        for name in tags:origins[name]='user';rejected.discard(name)
    for name in tag_names(additions):
        if name not in tags:tags.append(name)
        origins[name]='user';rejected.discard(name)
    for name in tag_names(removals):remove(name)
    for name in tag_names(restore):
        rejected.discard(name)
        if name in (photo.annotation or {}).get('tags',[]) and name not in tags:tags.append(name);origins[name]='ai'
    if len(rejected)>5000:raise HTTPException(400,'Invalid photo annotation.')
    state.update(tags=tags,tag_origins=origins,rejected_ai_tags=sorted(rejected))
    write_tags(session,photo,state)

def save_result(session,photo,payload):
    annotation=payload.model_dump(exclude={'expected_revision','source_hash'})
    annotation.update(revision=payload.expected_revision+1,updated_at=now())
    revision=func.coalesce(func.json_extract(Photo.annotation,'$.revision'),0)
    changed=session.execute(update(Photo).where(Photo.id==photo.id,Photo.file_hash==payload.source_hash,revision==payload.expected_revision).values(annotation=annotation,updated_at=now()))
    if changed.rowcount!=1:raise HTTPException(409,'Annotation source or revision changed. Reload the photo.')
    session.refresh(photo)
    state=tag_state(session,photo);origins=state['tag_origins'];rejected=set(state['rejected_ai_tags'])
    manual=[name for name in state['tags'] if origins[name]=='user']
    tags=manual+[name for name in annotation['tags'] if name not in rejected and name not in manual]
    state.update(tags=tags,tag_origins={name:'user' if name in manual else 'ai' for name in tags})
    write_tags(session,photo,state)
