"""Recoverable record removal. No original or derived image is deleted here."""
from sqlalchemy import select,func,text
import os
from ..models import Session,Photo,CaptureGroup

def existing_source(session,photo_id):
    """Read-only source view for an already saved work, not normal browsing."""
    from types import SimpleNamespace
    if session is None:
        with Session() as lookup:return existing_source(lookup,photo_id)
    photo=session.scalar(select(Photo).where(Photo.id==photo_id).execution_options(include_removed=True))
    if photo is None:return None
    return SimpleNamespace(**{c.name:(photo.removed_original_path if c.name=='file_path' and photo.removed_at else getattr(photo,c.name)) for c in Photo.__table__.columns})

def snapshot(page=1,page_size=40):
    if page<1 or not 1<=page_size<=100:raise ValueError('Invalid removal history page.')
    with Session() as session:
        query=select(Photo).where(Photo.removed_at.is_not(None)).execution_options(include_removed=True)
        total=session.scalar(select(func.count()).select_from(query.subquery()).execution_options(include_removed=True)) or 0
        photos=session.scalars(query.order_by(Photo.removed_at.desc(),Photo.id).offset((page-1)*page_size).limit(page_size)).all()
        return dict(total=total,page=page,page_size=page_size,items=[dict(id=p.id,file_name=p.file_name,file_path=p.removed_original_path,
            file_hash=p.file_hash,removed_at=p.removed_at,capture_group_id=p.capture_group_id) for p in photos])

def restore(ids):
    import re
    if not isinstance(ids,list) or not 1<=len(ids)<=1000 or any(not isinstance(v,str) or not re.fullmatch('[a-zA-Z0-9-]{1,80}',v) for v in ids) or len(set(ids))!=len(ids):raise ValueError('Invalid removal history selection.')
    with Session() as session:
        session.execute(text('BEGIN IMMEDIATE'))
        photos=session.scalars(select(Photo).where(Photo.id.in_(ids)).execution_options(include_removed=True)).all()
        if len(photos)!=len(ids):raise ValueError('Removed photo record no longer exists.')
        restoring=[p for p in photos if p.removed_at]
        occupied_paths={os.path.normcase(os.path.abspath(p.file_path)):p.id for p in session.execute(select(Photo.id,Photo.file_path))}
        destinations=set()
        for photo in restoring:
            path=photo.removed_original_path
            key=os.path.normcase(os.path.abspath(path)) if path else None
            if not key or key in destinations or key in occupied_paths:raise ValueError('The original path is occupied by another photo record. No records were restored.')
            occupied=session.scalar(select(Photo.id).where(Photo.file_path==path,Photo.id!=photo.id).execution_options(include_removed=True))
            if occupied:raise ValueError('The original path is occupied by another photo record. No records were restored.')
            destinations.add(key)
        for photo in restoring:
            photo.file_path=photo.removed_original_path;photo.removed_original_path=None;photo.removed_at=None
            from pathlib import Path
            photo.source_directory=str(Path(photo.file_path).parent).casefold()
        session.flush()
        for gid in {p.capture_group_id for p in restoring}:
            group=session.get(CaptureGroup,gid)
            if group is None:raise ValueError('Removed capture group is damaged. Restore a compatible backup.')
            active=session.scalars(select(Photo).where(Photo.capture_group_id==gid)).all()
            if not any(p.id==group.preferred_photo_id for p in active):
                preferred=sorted(active,key=lambda p:(p.is_raw,not p.preview_path,p.created_at,p.id))[0]
                group.preferred_photo_id=preferred.id
        session.commit()
        return dict(restored=len(restoring),originals_untouched=True)
