from typing import Literal
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.responses import Response
from io import BytesIO
from PIL import Image
from sqlalchemy import select, func
from .art_schemas import ArtGenerate, ArtTitleRequest, ArtSettings, ArtUpdate, ArtExport, ArtLayout
from .config import settings, save_settings, EXPORTS
from .models import Session, Artwork
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
        'title_model': config['art_title_model'], 'provider': 'OpenAI', 'exports_dir': str(EXPORTS)}


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
    return [job for job in jobs.recent() if job['kind'] in ('watercolor', 'watercolor-title')]


def submit(kind, function, payload, model):
    art.source_photo(payload.photo_id)
    art_credentials.get_key()
    with art.lock:
        if any(j['status'] in ('queued', 'running') for j in recent_jobs()):
            raise HTTPException(409, 'A watercolor task is already active; wait or cancel it first')
        result = jobs.submit(kind, function, payload, model, executor=art.pool)
        jobs.update(result['id'], photo_id=payload.photo_id)
        return jobs.get(result['id'])


@router.post('/generate', status_code=202)
def generate(payload: ArtGenerate):
    return submit('watercolor', art.generate, payload, settings()['art_image_model'])


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
def image(art_id: str, kind: Literal['preview', 'poster', 'scene']):
    with Session() as session:
        item = artwork(session, art_id)
        name = 'scene.png' if kind == 'scene' else f'{kind}-{item.revision}.{"webp" if kind == "preview" else "png"}'
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
        folder = art.folder_for(item.id)
        with Image.open(folder / 'scene.png') as scene:
            image = art.poster(scene, (item.source_json['width'], item.source_json['height']), payload.layout)
        revision = item.revision + 1
        try:
            art.save_poster(folder, image, revision)
            item.settings_json = payload.layout.model_dump()
            item.revision = revision
            session.commit()
        except Exception:
            (folder / f'poster-{revision}.png').unlink(missing_ok=True)
            (folder / f'preview-{revision}.webp').unlink(missing_ok=True)
            raise
        return art.serialize(item)


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
        folder = art.folder_for(item.id)
        # Delete only this generated artwork's files. Originals and exports remain intact.
        for path in folder.glob('*'):
            if path.is_file():
                path.unlink()
        if folder.is_dir():
            folder.rmdir()
        session.delete(item)
        session.commit()
        return {'ok': True}
