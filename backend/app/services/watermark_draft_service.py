"""Persistent editing state; cached previews and final exports have separate lifetimes."""
from pathlib import Path
from threading import RLock
from uuid import uuid4
from fastapi import HTTPException
from sqlalchemy import select
from ..config import DATA
from ..models import Session, Photo, WatermarkDraft, now
from ..schemas import WatermarkOptions
from . import watermark_service, jobs

# Serializes draft writes, preview replacement, and export snapshots in this local process.
lock = RLock()

def get_draft(session, draft_id: str) -> WatermarkDraft:
    draft = session.get(WatermarkDraft, draft_id)
    if not draft:
        raise HTTPException(404, '水印作品不存在')
    return draft

def source_snapshot(photo: Photo) -> dict:
    return {key: getattr(photo, key) for key in ('file_path','file_name','file_hash','camera_make',
        'camera_model','lens_model','date_taken')}

def serialize(draft: WatermarkDraft, photo: Photo | None) -> dict:
    result = {c.name: getattr(draft, c.name) for c in WatermarkDraft.__table__.columns}
    result['settings_json'] = WatermarkOptions.model_validate(draft.settings_json).model_dump()
    source = source_snapshot(photo) if photo else draft.source_json
    result.update(source=source, source_missing=not photo or not Path(photo.file_path).is_file(),
        preview_url=f'/api/watermark/drafts/{draft.id}/preview?v={Path(draft.preview_path).stem}' if draft.preview_path else None,
        modified_since_export=draft.exported_revision is not None and draft.revision > draft.exported_revision)
    return result

def preview(session, draft: WatermarkDraft) -> None:
    photo = session.get(Photo, draft.photo_id) if draft.photo_id else None
    if not photo or not Path(photo.file_path).is_file():
        return  # Retain the last good preview if the original has moved.
    image = watermark_service.render(photo, draft.settings_json, True)
    folder = DATA / 'watermark_previews'
    folder.mkdir(parents=True, exist_ok=True)
    style = WatermarkOptions.model_validate(draft.settings_json).style if draft.watermark_type == 'frame' else 'ambient'
    target = folder / f'{draft.id}-{style}-{uuid4().hex}.webp'
    image.save(target, 'WEBP', quality=82)
    draft.preview_path = str(target)

def remove_preview(path: str | None) -> None:
    if path:
        target = Path(path).resolve()
        if target.parent == (DATA / 'watermark_previews').resolve():
            target.unlink(missing_ok=True)

def save_preview_commit(session, draft: WatermarkDraft, render: bool) -> dict:
    previous = draft.preview_path
    try:
        if render:
            preview(session, draft)
        session.commit()
    except Exception:
        if draft.preview_path != previous:
            remove_preview(draft.preview_path)
        session.rollback()
        raise
    if previous != draft.preview_path:
        remove_preview(previous)
    return serialize(draft, session.get(Photo, draft.photo_id) if draft.photo_id else None)

def export_draft(draft_id: str, overrides: dict, index: int = 1) -> dict:
    with lock, Session() as session:
        draft = get_draft(session, draft_id)
        if not draft.photo_id:
            raise ValueError('原始照片不可用，请重新定位原始照片')
        overrides = overrides.copy()
        output_directory = overrides.pop('output_directory', None)
        options = draft.settings_json | overrides
        result = watermark_service.export_one(draft.photo_id, options, index, output_directory)
        draft.last_exported_at = now()
        draft.exported_revision = draft.revision
        draft.status = 'exported'
        draft.export_path = result['path']
        session.commit()
        return result | {'draft_id': draft.id}

def batch_export(job_id: str, ids: list[str], overrides: dict) -> None:
    results, errors = [], []
    jobs.update(job_id, total=len(ids))
    for index, draft_id in enumerate(ids, 1):
        jobs.update(job_id, current=draft_id)
        try:
            results.append(export_draft(draft_id, overrides, index))
        except Exception as error:
            errors.append(f'{draft_id}: {error}')
        jobs.update(job_id, processed=index, success=len(results), failed=len(errors), results=results, errors=errors)
