from typing import Literal
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.responses import Response
from io import BytesIO
from functools import partial
from PIL import Image
from sqlalchemy import select, func
from .art_schemas import ArtGenerate, ArtBatchGenerate, ArtTitleRequest, ArtSettings, ArtUpdate, ArtExport, ArtLayout
from .config import settings, save_settings, EXPORTS
from .models import Session, Artwork, WatermarkDraft, Photo
from .services import art_service as art, art_credentials, jobs

router = APIRouter(prefix='/api/art')


def artwork(session, art_id):
    value = session.get(Artwork, art_id)
    if not value:
        raise HTTPException(404, 'Artwork not found')
    return value


@router.get('/settings')
def get_settings():
    config = settings()
    return art_credentials.status() | {'image_model': config['art_image_model'],
        'title_model': config['art_title_model'], 'provider': 'Qwen', 'endpoint': art.API_URL, 'exports_dir': str(EXPORTS)}


@router.put('/settings')
def put_settings(payload: ArtSettings):
    with art.lock:
        if payload.clear_key and payload.api_key:
            raise ValueError('Choose either save or remove key')
        if payload.api_key:
            art_credentials.save_key(payload.api_key.get_secret_value())
        if payload.clear_key:
            art_credentials.KEY_FILE.unlink(missing_ok=True)
        save_settings({'art_image_model': payload.image_model, 'art_title_model': payload.title_model})
    return get_settings()


@router.get('/jobs')
def recent_jobs():
    return [job for job in jobs.recent() if job['kind'] in ('watercolor', 'watercolor-title', 'watercolor-batch')]


def submit(kind, function, payload, *models):
    photo_ids = payload.photo_ids if isinstance(payload, ArtBatchGenerate) else [payload.photo_id]
    hashes = {photo_id:art.source_photo(photo_id).file_hash for photo_id in photo_ids}
    payload = payload.model_copy(deep=True)
    function = partial(function, **({'source_hashes':hashes} if isinstance(payload, ArtBatchGenerate)
                                   else {'expected_hash':hashes[payload.photo_id]}))
    with art.lock:
        key = art_credentials.get_key()
        if any(j['status'] in ('queued', 'running') for j in recent_jobs()):
            raise HTTPException(409, 'A watercolor task is already active; wait or cancel it first')
        # Queue a closure, not the secret itself; jobs persist only public metadata.
        approved = lambda job_id, *args: art.authorized_request(function, key, job_id, *args)
        result = jobs.submit(kind, approved, payload, *models, executor=art.pool)
        jobs.update(result['id'], **({'photo_ids': photo_ids} if isinstance(payload, ArtBatchGenerate) else {'photo_id': payload.photo_id}))
        return jobs.get(result['id'])


@router.post('/generate', status_code=202)
def generate(payload: ArtGenerate):
    return submit('watercolor', art.generate, payload, settings()['art_image_model'])


@router.post('/batch', status_code=202)
def generate_batch(payload: ArtBatchGenerate):
    config = settings()
    return submit('watercolor-batch', art.generate_batch, payload, config['art_image_model'], config['art_title_model'])


@router.post('/titles', status_code=202)
def titles(payload: ArtTitleRequest):
    return submit('watercolor-title', art.suggest_titles, payload, settings()['art_title_model'])


@router.get('/works')
def works(page: int = Query(1, ge=1), page_size: int = Query(24, ge=1, le=100)):
    with Session() as session:
        total = session.scalar(select(func.count()).select_from(Artwork))
        items = session.scalars(select(Artwork).order_by(Artwork.created_at.desc(), Artwork.id)
                               .offset((page - 1) * page_size).limit(page_size))
        return {'works': [art.serialize(item) for item in items], 'total': total}


@router.get('/works/{art_id}')
def get_work(art_id: str):
    with Session() as session:
        return art.serialize(artwork(session, art_id))


@router.get('/works/{art_id}/{kind}')
def image(art_id: str, kind: Literal['preview', 'poster', 'scene'], revision: int | None = Query(None, ge=1)):
    with Session() as session:
        item = artwork(session, art_id)
        version = item.revision if revision is None else revision
        if version > item.revision:
            raise HTTPException(404, 'Artwork version is not available')
        name = 'scene.png' if kind == 'scene' else f'{kind}-{version}.{"webp" if kind == "preview" else "png"}'
        path = art.folder_for(item.id) / name
        if not path.is_file():
            raise HTTPException(404, 'Artwork file is missing')
        return FileResponse(path, headers={'Cache-Control': 'no-cache'},
                            filename='watercolor.png' if kind == 'poster' else None)


@router.put('/works/{art_id}')
def update_work(art_id: str, payload: ArtUpdate):
    with art.lock, Session() as session:
        item = artwork(session, art_id)
        if item.revision != payload.revision:
            raise HTTPException(409, 'Artwork changed elsewhere; reopen it before saving')
        return art.update_layout(session, item, payload.layout)


@router.post('/works/{art_id}/preview')
def preview(art_id: str, payload: ArtLayout):
    with art.lock, Session() as session:
        item = artwork(session, art_id)
        with Image.open(art.folder_for(item.id) / 'scene.png') as scene:
            image = art.poster(scene, (item.source_json['width'], item.source_json['height']), payload)
        image.thumbnail((1000, 1000), Image.Resampling.LANCZOS)
        buffer = BytesIO()
        image.save(buffer, 'WEBP', quality=90)
        return Response(buffer.getvalue(), media_type='image/webp')


@router.post('/works/{art_id}/export')
def export(art_id: str, payload: ArtExport):
    with art.lock, Session() as session:
        return art.export(artwork(session, art_id), payload.format)


@router.delete('/works/{art_id}')
def delete_work(art_id: str):
    with art.lock, Session() as session:
        item = artwork(session, art_id)
        if session.scalar(select(WatermarkDraft.id).where(WatermarkDraft.artwork_id == item.id).limit(1)):
            raise HTTPException(409, '这幅水彩仍被水印作品使用，请先删除关联水印作品')
        # Keep generated bytes for the explicit, reference-checked recycle action.
        # A generated file may itself have been registered as somebody's original.
        session.delete(item)
        session.commit()
        return {'ok': True}


@router.post('/works/{art_id}/watermark', status_code=201)
def create_watermark(art_id: str):
    from .schemas import WatermarkOptions
    from .services import watermark_draft_service as drafts
    with art.lock, drafts.lock, Session() as session:
        item = artwork(session, art_id)
        photo = session.get(Photo, item.photo_id) if item.photo_id else None
        options = WatermarkOptions().model_dump()
        # Pin the saved poster revision so later layout edits cannot silently alter this draft.
        snapshot = item.source_json | {'artwork_revision': item.revision,
                    'file_name': 'watercolor_' + item.source_json['file_name']}
        from .services.safe_image_export import digest
        snapshot['artwork_poster_hash'] = digest(art.folder_for(item.id) / f'poster-{item.revision}.png')
        draft = WatermarkDraft(photo_id=item.photo_id, artwork_id=item.id,
            capture_group_id=photo.capture_group_id if photo else None,
            name=(item.settings_json['title'] or item.source_json['file_name'])[:180],
            watermark_type=options['template'], template_id=options['template'],
            settings_json=options, source_json=snapshot)
        session.add(draft)
        session.flush()
        return drafts.save_preview_commit(session, draft, True)
