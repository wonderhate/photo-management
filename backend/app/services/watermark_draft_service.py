"""Persistent editing state; cached previews and final exports have separate lifetimes."""
from pathlib import Path
from threading import RLock
from uuid import uuid4
from types import SimpleNamespace
from copy import deepcopy
from fastapi import HTTPException
from sqlalchemy import select
from ..config import DATA
from ..models import Session, Photo, AssetVariant, WatermarkDraft, now
from ..schemas import WatermarkOptions
from . import watermark_service, jobs

# Serializes draft writes, preview replacement, and export snapshots in this local process.
lock = RLock()
PREVIEW_LAYOUT = 'centered-signature'
AMBIENT_PREVIEW_LAYOUT = 'centered-signature-stable-ambient'


def preview_layout(draft) -> str:
    return AMBIENT_PREVIEW_LAYOUT if draft.watermark_type == 'ambient' else PREVIEW_LAYOUT

def get_draft(session, draft_id: str) -> WatermarkDraft:
    draft = session.get(WatermarkDraft, draft_id)
    if not draft:
        raise HTTPException(404, '水印作品不存在')
    return draft

def source_snapshot(photo: Photo) -> dict:
    return {key: getattr(photo, key) for key in ('file_path','file_name','file_hash','camera_make',
        'camera_model','lens_model','date_taken','focal_length','f_number','exposure_time','iso')}

def draft_source(session, draft: WatermarkDraft, verify: bool = True):
    if draft.asset_variant_id:
        from .editor_service import variant_path
        if session is None:
            with Session() as lookup:
                return draft_source(lookup,draft,verify)
        variant=session.get(AssetVariant,draft.asset_variant_id)
        if not variant: return None
        try: path=variant_path(variant,verify)
        except HTTPException:
            if verify: raise
            return None
        values={key:draft.source_json.get(key) for key in ('file_name','camera_make','camera_model','lens_model','focal_length','f_number','exposure_time','iso','date_taken')}
        return SimpleNamespace(**values,file_path=str(path),preview_path=None,created_at=draft.created_at)
    if not draft.artwork_id:
        from .removed_photos import existing_source
        return existing_source(session,draft.photo_id) if draft.photo_id else None
    from .art_service import folder_for
    source = draft.source_json
    revision = int(source['artwork_revision'])
    path = folder_for(draft.artwork_id) / f'poster-{revision}.png'
    expected = source.get('artwork_poster_hash')
    if verify and expected:
        from .safe_image_export import digest
        if not path.is_file() or digest(path) != expected:
            raise ValueError('The source photo changed. Reopen it before saving.')
    values = {key: source.get(key) for key in ('file_name', 'camera_make', 'camera_model', 'lens_model',
              'focal_length', 'f_number', 'exposure_time', 'iso', 'date_taken')}
    return SimpleNamespace(**values, file_path=str(path), file_hash=expected, preview_path=None, created_at=draft.created_at)


def serialize(draft: WatermarkDraft, photo: Photo | None) -> dict:
    if (photo is None or getattr(photo,'removed_at',None)) and draft.photo_id and not draft.artwork_id and not draft.asset_variant_id:
        from .removed_photos import existing_source
        photo=existing_source(None,draft.photo_id)
    result = {c.name: getattr(draft, c.name) for c in WatermarkDraft.__table__.columns}
    result['settings_json'] = WatermarkOptions.model_validate(draft.settings_json).model_dump()
    source = source_snapshot(photo) if photo and not draft.artwork_id and not draft.asset_variant_id else draft.source_json
    if draft.artwork_id:
        photo = draft_source(None, draft, False)
    elif draft.asset_variant_id:
        photo = draft_source(None,draft,False)
    result.update(source=source, source_missing=not photo or not Path(photo.file_path).is_file(),
        preview_url=f'/api/watermark/drafts/{draft.id}/preview?v={Path(draft.preview_path).stem}' if draft.preview_path else None,
        modified_since_export=draft.exported_revision is not None and draft.revision > draft.exported_revision)
    return result

def preview(session, draft: WatermarkDraft) -> None:
    photo = draft_source(session, draft)
    if not photo or not Path(photo.file_path).is_file():
        return  # Retain the last good preview if the original has moved.
    image = watermark_service.render(photo, draft.settings_json, True)
    folder = DATA / 'watermark_previews'
    folder.mkdir(parents=True, exist_ok=True)
    style = WatermarkOptions.model_validate(draft.settings_json).style if draft.watermark_type == 'frame' else 'ambient'
    target = folder / f'{draft.id}-{style}-{preview_layout(draft)}-{uuid4().hex}.webp'
    image.save(target, 'WEBP', quality=82)
    draft.preview_path = str(target)

def remove_preview(path: str | None) -> None:
    # Released previews are collected by the explicit recycle operation. They can
    # still be an original source or a frozen preview referenced by another draft.
    pass

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

def export_snapshots(ids: list[str]) -> list[dict]:
    """Freeze each design at submission, before a queued batch can be edited."""
    with lock, Session() as session:
        return [deepcopy({c.name: getattr(draft, c.name) for c in WatermarkDraft.__table__.columns})
                for draft in (get_draft(session, value) for value in ids)]


def export_draft(draft_id: str, overrides: dict, index: int = 1, *, snapshot=None, job_id=None) -> dict:
    with lock, Session() as session:
        draft = SimpleNamespace(**deepcopy(snapshot)) if snapshot is not None else get_draft(session, draft_id)
        photo = draft_source(session, draft)
        if not photo:
            raise ValueError('原始照片不可用，请重新定位原始照片')
        if snapshot is not None and not draft.artwork_id and not draft.asset_variant_id:
            photo = SimpleNamespace(**(draft.source_json | {'file_path':photo.file_path,
                                    'preview_path':None,'created_at':photo.created_at}))
        overrides = overrides.copy()
        output_directory = overrides.pop('output_directory', None)
        options = draft.settings_json | overrides
        result = watermark_service.export_source(photo, options, index, output_directory, job_id=job_id)
        # A later edit (or removal) must not be labelled exported by an older job.
        current = session.get(WatermarkDraft, draft_id)
        if current and (current.exported_revision is None or current.exported_revision <= draft.revision):
            current.last_exported_at = now()
            current.exported_revision = draft.revision
            if current.revision == draft.revision:
                current.status = 'exported'
            current.export_path = result['path']
        session.commit()
        return result | {'draft_id': draft.id, 'draft_revision': draft.revision}

def batch_export(job_id: str, ids: list[str], overrides: dict, snapshots=None) -> None:
    snapshots = snapshots if snapshots is not None else export_snapshots(ids)
    results, errors = [], []
    jobs.update(job_id, total=len(ids))
    for index, draft_id in enumerate(ids, 1):
        jobs.check(job_id)
        jobs.update(job_id, current=draft_id)
        try:
            results.append(export_draft(draft_id, overrides, index, snapshot=snapshots[index-1], job_id=job_id))
        except jobs.JobCancelled:
            raise
        except Exception as error:
            errors.append(f'{draft_id}: {error}')
        jobs.update(job_id, processed=index, success=len(results), failed=len(errors), results=results, errors=errors)
