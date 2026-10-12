from contextlib import asynccontextmanager, closing
from io import BytesIO
from pathlib import Path
from typing import Literal
import json
import os
import subprocess
import sys
from uuid import uuid4
from tempfile import TemporaryDirectory
from fastapi import FastAPI, HTTPException, Request, UploadFile, File
from fastapi.responses import FileResponse, Response, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, func, delete
from .config import DATA, EXPORTS, SCAN_PATHS, MODELS, PROJECT, EXTENSIONS, AUTOLOAD_AI, settings, save_settings
from .models import initialize, Session, Photo, CaptureGroup, Album, AlbumPhoto, Tag, PhotoTag, now
from .schemas import ImportRequest, PhotoUpdate, SmartRequest, AlbumRequest, WatermarkRequest, BatchRequest, SettingsRequest
from .services import jobs, import_service, library_service, stats_service, watermark_service, scan_service, export_registry
from .services.embedding_service import service as ai
from .services import timeline_service, face_service, nl_search, plugin_service
from .schemas import ImportRequest, PhotoUpdate, SmartRequest, AlbumRequest, WatermarkRequest, BatchRequest, SettingsRequest, BatchEditRequest, FacePersonCreate, FacePersonRename, AlbumUpdate, AlbumOrderRequest, PluginRunRequest, IdsRequest
from .models import FacePerson, DetectedFace
from .config import storage_paths, save_storage_paths, cancel_storage_paths
from .schemas import StoragePathsRequest

@asynccontextmanager
async def lifespan(_app: FastAPI):
    initialize()
    jobs.recover()
    if AUTOLOAD_AI and any(MODELS.glob('models--OFA-Sys--chinese-clip-vit-base-patch16/snapshots/*')):
        ai.start(False)
    scan_service.start()
    yield

from backend.version import VERSION,build_id
BUILD_ID=build_id()
app = FastAPI(title='光影集 · 本地摄影照片管理', version=VERSION, lifespan=lifespan)
from .watermark_drafts import router as draft_router
app.include_router(draft_router)
from .face_routes import router as face_router
app.include_router(face_router)
from . import remote
app.include_router(remote.router)
app.add_middleware(CORSMiddleware, allow_origins=['http://localhost:5173','http://127.0.0.1:5173','http://localhost:8000','http://127.0.0.1:8000'], allow_methods=['GET','POST','PATCH','DELETE','PUT'], allow_headers=['Content-Type'])

@app.middleware('http')
async def protect_local_requests(request: Request, call_next):
    origin = request.headers.get('origin')
    allowed = {'http://localhost:5173','http://127.0.0.1:5173','http://localhost:8000','http://127.0.0.1:8000'}
    blocked = remote.guard(request)
    if blocked is not None:
        response = blocked
    elif request.method not in ('GET','HEAD','OPTIONS') and origin and origin not in allowed and origin != str(request.base_url).rstrip('/'):
        response = JSONResponse({'detail':'禁止来自其他网站的本地操作'}, status_code=403)
    else:
        response = await call_next(request)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Referrer-Policy'] = 'no-referrer'
    if request.url.path.startswith('/api/remote/') or not remote.local_request(request) or request.cookies.get(remote.COOKIE) or 'PhotoCollectionRemote/' in request.headers.get('user-agent', ''):
        response.headers['Cache-Control'] = 'no-store, max-age=0'
        response.headers['Pragma'] = 'no-cache'
    if response.headers.get('content-type', '').startswith('text/html') and request.url.path not in ('/docs', '/redoc', '/docs/oauth2-redirect'):
        response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
    return response

@app.exception_handler(ValueError)
async def value_error(_request: Request, error: ValueError):
    return JSONResponse({'detail': str(error)}, status_code=400)

def photo_or_404(session, photo_id: str) -> Photo:
    photo = session.get(Photo, photo_id)
    if not photo: raise HTTPException(404, '照片不存在')
    return photo

def filters(request: Request) -> dict:
    result = dict(request.query_params)
    if result.get('camera'): result['camera_model'] = result['camera']
    if result.get('lens'): result['lens_model'] = result['lens']
    for key, value in result.items():
        if any(key == field or key.startswith(field + '_') for field in ('focal_length','f_number','iso','exposure_seconds')) and value:
            float(value)
    return result

def count_mode(request: Request) -> str:
    value = request.query_params.get('count_mode', settings()['count_mode'])
    if value not in ('capture','file'): raise ValueError('统计方式须为 capture 或 file')
    return value

@app.get('/api/health')
def health():
    return {'status':'ok','version':VERSION,'build_id':BUILD_ID,'data_dir':str(DATA),'exports_dir':str(EXPORTS)}

@app.get('/api/library/scan')
def scan_status():
    return scan_service.status()

@app.post('/api/library/scan')
def scan_library(force: bool = False):
    return scan_service.start(force)

@app.post('/api/dialog/{kind}')
def picker(kind: Literal['files','directory'], request: Request):
    remote.require_local(request)
    creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
    if getattr(sys, 'frozen', False):
        with TemporaryDirectory(prefix='photo-picker-') as directory:
            target = Path(directory) / 'result.json'
            result = subprocess.run([sys.executable, '--dialog', kind, '--result', str(target)], timeout=300, creationflags=creationflags)
            if result.returncode or not target.is_file(): raise HTTPException(503, '系统文件选择器不可用，请粘贴绝对路径')
            return {'paths': json.loads(target.read_text('utf-8'))}
    result = subprocess.run([sys.executable, '-m', 'backend.app.dialog', kind], cwd=PROJECT, capture_output=True, text=True, timeout=300, creationflags=creationflags)
    if result.returncode: raise HTTPException(503, '系统文件选择器不可用，请粘贴绝对路径')
    return {'paths': json.loads(result.stdout)}

@app.get('/api/files/browse')
def browse_computer_files(path: str = '', directories_only: bool = False, page: int = 1):
    from .file_browser import browse
    return browse(path, directories_only, page)

@app.post('/api/photos/import', status_code=202)
def import_photos(payload: ImportRequest):
    return jobs.submit('import', import_service.import_paths, payload.paths, payload.recursive)

@app.post('/api/photos/upload', status_code=202)
def upload_photos(files: list[UploadFile] = File(...)):
    # Browser drag/drop never exposes absolute paths. Only explicitly dropped files are copied.
    paths = []
    batch = DATA / 'imports' / str(uuid4())
    batch.mkdir()
    for upload in files:
        name = Path((upload.filename or 'image').replace('\\','/')).name
        if Path(name).suffix.lower() not in EXTENSIONS:
            continue
        target = batch / name
        if target.exists(): target = batch / (str(uuid4()) + '-' + name)
        with target.open('xb') as stream:
            while chunk := upload.file.read(1024*1024): stream.write(chunk)
        paths.append(str(target))
    if not paths: raise ValueError('没有支持的照片文件')
    return jobs.submit('import', import_service.import_paths, paths, False)

@app.get('/api/jobs')
def recent_jobs():
    return jobs.recent()

@app.get('/api/jobs/{job_id}')
def get_job(job_id: str):
    result = jobs.get(job_id)
    if not result: raise HTTPException(404, '任务不存在或服务已重启；可重新执行，重复导入会跳过')
    return result

@app.post('/api/jobs/{job_id}/cancel')
def cancel_job(job_id: str):
    result = jobs.cancel(job_id)
    if not result: raise HTTPException(404, '任务不存在或服务已重启')
    return result

def ordered_photos(request: Request, sort: str, direction: str):
    q = library_service.query_photos(filters(request), 'capture')
    if sort == 'manual' and request.query_params.get('album_id'):
        positions = select(Photo.capture_group_id.label('gid'), func.min(AlbumPhoto.position).label('pos')).join(AlbumPhoto, AlbumPhoto.photo_id == Photo.id).where(AlbumPhoto.album_id == request.query_params['album_id']).group_by(Photo.capture_group_id).subquery()
        return q.join(positions, positions.c.gid == Photo.capture_group_id).order_by(positions.c.pos, Photo.id)
    column = {'date_taken':Photo.date_taken, 'created_at':Photo.created_at, 'file_name':Photo.file_name}.get(sort, Photo.date_taken)
    return q.order_by(column.asc() if direction == 'asc' else column.desc(), Photo.id)

@app.get('/api/photos')
def get_photos(request: Request, page: int = 1, page_size: int = 80, sort: str = 'date_taken', direction: str = 'desc'):
    if page < 1 or not 1 <= page_size <= 200: raise ValueError('分页参数超出范围')
    q = ordered_photos(request, sort, direction)
    with Session() as session:
        total = session.scalar(select(func.count()).select_from(q.order_by(None).subquery()))
        photos = session.scalars(q.offset((page-1)*page_size).limit(page_size)).all()
        return {'photos':library_service.serialize(session, photos), 'total':total, 'page':page, 'page_size':page_size}

@app.get('/api/filter-options')
def filter_options():
    with Session() as session:
        result = {}
        for field in ['camera_model','lens_model','focal_length','f_number','iso','exposure_seconds']:
            column = getattr(Photo, field)
            result[field] = list(session.scalars(select(column).where(column.is_not(None)).distinct().order_by(column)))
        result['tags'] = list(session.scalars(select(Tag.name).order_by(Tag.name)))
        return result

@app.get('/api/photos/ids')
def photo_ids(request: Request, sort: str = 'date_taken', direction: str = 'desc'):
    q = ordered_photos(request, sort, direction).with_only_columns(Photo.id)
    with Session() as session:
        return {'ids': list(session.scalars(q))}

@app.get('/api/search/parse')
def search_parse(q: str):
    with Session() as session:
        return nl_search.parse(q, session)

@app.post('/api/photos/by-ids')
def photos_by_ids(payload: IdsRequest):
    with Session() as session:
        photos = session.scalars(select(Photo).where(Photo.id.in_(payload.ids))).all()
        order = {photo.id: photo for photo in photos}
        return {'photos': library_service.serialize(session, [order[i] for i in payload.ids if i in order])}

@app.get('/api/plugins')
def plugins_list():
    return plugin_service.discover()

@app.post('/api/plugins/{name}/run')
def plugin_run(name: str, payload: PluginRunRequest):
    return plugin_service.run(name, payload.params)

@app.get('/api/photos/{photo_id}')
def photo_detail(photo_id: str):
    with Session() as session:
        return library_service.serialize(session, [photo_or_404(session, photo_id)], True)[0]

@app.patch('/api/photos/{photo_id}')
def update_photo(photo_id: str, payload: PhotoUpdate):
    with Session() as session:
        photo = photo_or_404(session, photo_id)
        if payload.favorite is not None: photo.favorite = payload.favorite
        if 'rating' in payload.model_fields_set: photo.rating = payload.rating
        if payload.color_label is not None:
            photo.color_label = None if payload.color_label == 'none' else payload.color_label
        if payload.tags is not None: library_service.set_tags(session, photo, payload.tags)
        photo.updated_at = now()
        session.commit()
        return library_service.serialize(session, [photo], True)[0]

@app.post('/api/photos/batch-edit')
def batch_edit_photos(payload: BatchEditRequest):
    with Session() as session:
        photos = session.scalars(select(Photo).where(Photo.id.in_(payload.photo_ids))).all()
        if not photos: raise HTTPException(404, '未找到照片')
        for photo in photos:
            if payload.favorite is not None: photo.favorite = payload.favorite
            if payload.rating is not None: photo.rating = payload.rating
            if payload.clear_rating: photo.rating = None
            if payload.color_label is not None:
                photo.color_label = None if payload.color_label == 'none' else payload.color_label
            if payload.clear_color_label: photo.color_label = None
            if payload.add_tags or payload.remove_tags:
                existing = set(session.scalars(select(Tag.name).join(PhotoTag).where(PhotoTag.photo_id == photo.id)))
                additions = {name.strip()[:100] for name in payload.add_tags or [] if name.strip()}
                removals = {name.strip()[:100] for name in payload.remove_tags or [] if name.strip()}
                library_service.set_tags(session, photo, sorted((existing | additions) - removals))
            photo.updated_at = now()
        session.commit()
        return {'updated': len(photos)}

@app.delete('/api/photos/{photo_id}')
def delete_photo(photo_id: str, scope: Literal['capture','file'] = 'capture'):
    with Session() as session:
        removed = library_service.remove_photo(session, photo_or_404(session, photo_id), scope == 'capture')
        return {'removed':removed,'originals_untouched':True}

@app.get('/api/photos/{photo_id}/{kind}')
def photo_file(photo_id: str, kind: Literal['thumbnail','preview','original']):
    with Session() as session:
        photo = photo_or_404(session, photo_id)
        if kind != 'original' and settings()['preview_preference'] == 'raw':
            raw = session.scalar(select(Photo).where(Photo.capture_group_id == photo.capture_group_id, Photo.is_raw.is_(True), Photo.preview_path.is_not(None)))
            photo = raw or photo
        path = photo.file_path if kind == 'original' else photo.thumbnail_path if kind == 'thumbnail' else photo.preview_path
        if not path or not Path(path).is_file(): raise HTTPException(404, '原始文件已移动或预览不可用')
        return FileResponse(path, filename=photo.file_name if kind == 'original' else None, headers={'Cache-Control':'private, max-age=86400'} if kind != 'original' else None)

@app.post('/api/photos/{photo_id}/reveal')
def reveal_photo(photo_id: str):
    with Session() as session:
        path = Path(photo_or_404(session, photo_id).file_path)
    if not path.exists(): raise HTTPException(404,'原图已移动或删除')
    if os.name == 'nt': subprocess.Popen(['explorer.exe', '/select,', str(path)], creationflags=subprocess.CREATE_NO_WINDOW)
    return {'path':str(path)}

@app.post('/api/photos/{photo_id}/open')
def open_photo(photo_id: str):
    with Session() as session:
        path = Path(photo_or_404(session, photo_id).file_path)
    if not path.exists(): raise HTTPException(404,'原图已移动或删除')
    if os.name == 'nt': os.startfile(str(path))
    return {'path':str(path)}

@app.get('/api/stats')
def stats(request: Request, mode: Literal['grouped','exact']='grouped'):
    return stats_service.statistics(filters(request), count_mode(request), mode)

@app.get('/api/stats/{metric}')
def stat_metric(metric: str, request: Request, mode: Literal['grouped','exact']='grouped'):
    field = {'focal-length':'focal_length','aperture':'f_number','iso':'iso','shutter':'exposure_seconds'}.get(metric)
    if not field: raise HTTPException(404,'未知统计维度')
    return stats_service.histogram(stats_service.rows(filters(request), count_mode(request)), field, mode)

@app.get('/api/reports/monthly/{year}/{month}')
def monthly(year: int, month: int, request: Request):
    return stats_service.report(year, month, filters(request), count_mode(request))

@app.get('/api/reports/yearly/{year}')
def yearly(year: int, request: Request):
    return stats_service.report(year, None, filters(request), count_mode(request))

@app.get('/api/reports/monthly')
def monthly_query(request: Request, year: int, month: int):
    return monthly(year, month, request)

@app.get('/api/reports/yearly')
def yearly_query(request: Request, year: int):
    return yearly(year, request)

@app.get('/api/reports/lenses')
def lenses(request: Request):
    return stats_service.histogram(stats_service.rows(filters(request), count_mode(request)), 'lens_model', 'exact')

@app.get('/api/reports/lenses/{lens_name}')
def lens_detail(lens_name: str, request: Request):
    return stats_service.lens_lifecycle(lens_name, count_mode(request))

@app.get('/api/reports/lenses/{lens_name}/monthly')
def lens_month(lens_name: str, request: Request, year: int, month: int):
    return stats_service.report(year, month, filters(request) | {'lens_model':lens_name}, count_mode(request))

@app.get('/api/reports/lenses/{lens_name}/yearly')
def lens_year(lens_name: str, request: Request, year: int):
    return stats_service.report(year, None, filters(request) | {'lens_model':lens_name}, count_mode(request))

def album_dict(session, album: Album) -> dict:
    result = {c.name:getattr(album,c.name) for c in Album.__table__.columns}
    result['count'] = session.scalar(select(func.count(func.distinct(Photo.capture_group_id))).join(AlbumPhoto, AlbumPhoto.photo_id == Photo.id).where(AlbumPhoto.album_id == album.id))
    result['cover_id'] = album.cover_photo_id or session.scalar(select(AlbumPhoto.photo_id).where(AlbumPhoto.album_id == album.id).order_by(AlbumPhoto.position).limit(1))
    return result

@app.get('/api/albums')
def albums():
    with Session() as session:
        return [album_dict(session,a) for a in session.scalars(select(Album).order_by(Album.created_at.desc()))]

@app.post('/api/albums/smart/preview')
def smart_preview(payload: SmartRequest):
    matches = ai.search(payload.keywords, payload.match_mode, payload.threshold, payload.max_results)
    with Session() as session:
        ids = [m['photo_id'] for m in matches]
        photos = session.scalars(select(Photo).where(Photo.id.in_(ids))).all()
        records = {p['id']:p for p in library_service.serialize(session, photos)}
        return {'model':ai.model_name,'candidates':[records[m['photo_id']] | {'similarity_score':m['similarity_score']} for m in matches if m['photo_id'] in records]}

@app.post('/api/albums')
@app.post('/api/albums/smart/create')
def create_album(payload: AlbumRequest):
    if payload.type == 'smart' and not any(k.strip() for k in payload.keywords): raise ValueError('智能影集需要关键词')
    with Session() as session:
        if payload.person_id is not None:
            if payload.type != 'normal' or payload.photo_ids: raise ValueError('人物影集请使用普通影集，照片由人物分组自动选取')
            if not session.get(FacePerson, payload.person_id): raise HTTPException(404, '人物不存在')
            if session.scalar(select(DetectedFace.id).where(DetectedFace.person_id==payload.person_id, DetectedFace.confirmed.is_(False)).limit(1)):
                raise ValueError('请先确认该人物的分组，再新建人物影集')
            members = session.scalars(library_service.query_photos({'person_id':payload.person_id}).order_by(Photo.date_taken.desc(), Photo.id)).all()
            if not members: raise ValueError('该人物没有已确认的照片')
        else:
            members = session.scalars(select(Photo).where(Photo.id.in_(payload.photo_ids))).all()
        album = Album(**payload.model_dump(exclude={'photo_ids','scores','person_id'}), ai_model=ai.model_name if payload.type=='smart' else None)
        session.add(album)
        session.flush()
        seen = set()
        for position, photo in enumerate(members):
            if photo.capture_group_id in seen: continue
            seen.add(photo.capture_group_id)
            session.add(AlbumPhoto(album_id=album.id, photo_id=photo.id, similarity_score=payload.scores.get(photo.id), position=position if payload.person_id else 0))
        session.commit()
        return album_dict(session,album)

@app.get('/api/albums/{album_id}')
def album_detail(album_id: str):
    with Session() as session:
        album = session.get(Album,album_id)
        if not album: raise HTTPException(404,'影集不存在')
        return album_dict(session,album)

@app.delete('/api/albums/{album_id}')
def album_delete(album_id: str):
    with Session() as session:
        album = session.get(Album,album_id)
        if not album: raise HTTPException(404,'影集不存在')
        session.delete(album)
        session.commit()
        return {'ok':True}

@app.post('/api/albums/{album_id}/rerun')
def rerun_album(album_id: str):
    with Session() as session:
        album = session.get(Album,album_id)
        if not album or album.type != 'smart': raise HTTPException(404,'智能影集不存在')
        payload = SmartRequest(keywords=album.keywords, match_mode=album.match_mode, threshold=album.threshold, max_results=album.max_results)
    return smart_preview(payload)

@app.put('/api/albums/{album_id}/photos')
def replace_album_photos(album_id: str, payload: AlbumRequest):
    with Session() as session:
        album = session.get(Album,album_id)
        if not album: raise HTTPException(404,'影集不存在')
        session.execute(delete(AlbumPhoto).where(AlbumPhoto.album_id==album_id))
        existing = set(session.scalars(select(Photo.id).where(Photo.id.in_(payload.photo_ids))))
        for photo_id in existing: session.add(AlbumPhoto(album_id=album_id,photo_id=photo_id,similarity_score=payload.scores.get(photo_id)))
        album.updated_at=now()
        session.commit()
        return album_dict(session,album)

@app.patch('/api/albums/{album_id}')
def update_album(album_id: str, payload: AlbumUpdate):
    with Session() as session:
        album = session.get(Album,album_id)
        if not album: raise HTTPException(404,'影集不存在')
        if payload.cover_photo_id is not None:
            if payload.cover_photo_id and not session.get(Photo,payload.cover_photo_id): raise ValueError('封面照片不存在')
            album.cover_photo_id = payload.cover_photo_id or None
        album.updated_at=now()
        session.commit()
        return album_dict(session,album)

@app.put('/api/albums/{album_id}/order')
def order_album(album_id: str, payload: AlbumOrderRequest):
    with Session() as session:
        album = session.get(Album,album_id)
        if not album: raise HTTPException(404,'影集不存在')
        members = {m.photo_id:m for m in session.scalars(select(AlbumPhoto).where(AlbumPhoto.album_id==album_id))}
        position = 0
        for photo_id in payload.photo_ids:
            member = members.pop(photo_id,None)
            if member:
                member.position = position
                position += 1
        for member in members.values():
            member.position = position
            position += 1
        album.updated_at=now()
        session.commit()
        return album_dict(session,album)

@app.get('/api/ai/status')
def ai_status(): return ai.status()

@app.post('/api/ai/load')
def ai_load(download: bool = True): return ai.start(download)

@app.post('/api/watermark/preview')
def watermark_preview(payload: WatermarkRequest):
    with Session() as session:
        photo = photo_or_404(session, payload.photo_id)
        image = watermark_service.render(photo, payload.options.model_dump(), True)
    stream = BytesIO()
    image.save(stream, 'JPEG', quality=88)
    return Response(stream.getvalue(), media_type='image/jpeg')

@app.get('/api/watermark/signatures/{style}')
def watermark_signature(style: Literal['natural', 'fine', 'brush', 'calligraphy']):
    from .watermark.signatures import signature_image
    image = signature_image({'fields':['signature'], 'signature':'wonder', 'signature_style':style})
    stream = BytesIO()
    image.save(stream, 'PNG')
    return Response(stream.getvalue(), media_type='image/png')

@app.post('/api/watermark/export')
def watermark_export(payload: WatermarkRequest):
    return watermark_service.export_one(payload.photo_id, payload.options.model_dump())

@app.post('/api/watermark/batch-export', status_code=202)
def watermark_batch(payload: BatchRequest):
    return jobs.submit('export', watermark_service.batch_export, list(dict.fromkeys(payload.photo_ids)), payload.options.model_dump())

@app.get('/api/exports/{filename}')
def export_file(filename: str):
    target = export_registry.lookup(filename)
    if target is None: raise HTTPException(404,'导出文件不存在')
    return FileResponse(target, filename=target.name)

@app.get('/api/timeline')
def timeline(request: Request):
    return timeline_service.get_timeline_hierarchy(count_mode(request))

@app.get('/api/timeline/heatmap/{year}')
def timeline_heatmap(year: int, request: Request):
    return timeline_service.get_calendar_heatmap(year, count_mode(request))

@app.get('/api/timeline/{year}')
def timeline_year(year: int, request: Request, page: int = 1, page_size: int = 80):
    return timeline_service.date_photos(year, page=page, page_size=page_size, count_mode=count_mode(request))

@app.get('/api/timeline/{year}/{month}')
def timeline_month(year: int, month: int, request: Request, page: int = 1, page_size: int = 80):
    return timeline_service.date_photos(year, month, page=page, page_size=page_size, count_mode=count_mode(request))

@app.get('/api/timeline/{year}/{month}/{day}')
def timeline_day(year: int, month: int, day: int, request: Request, page: int = 1, page_size: int = 80):
    return timeline_service.date_photos(year, month, day, page=page, page_size=page_size, count_mode=count_mode(request))

@app.get('/api/compare')
def compare_photos(ids: str):
    photo_ids = ids.split(',')
    if len(photo_ids) < 2 or len(photo_ids) > 4:
        raise ValueError('对比需要 2-4 张照片')
    with Session() as session:
        photos = session.scalars(select(Photo).where(Photo.id.in_(photo_ids))).all()
        if len(photos) != len(photo_ids):
            raise HTTPException(404, '部分照片不存在')
        return {'photos': library_service.serialize(session, photos, True)}

@app.get('/api/faces/status')
def face_status():
    return face_service.status()

@app.post('/api/photos/{photo_id}/detect-faces')
def detect_faces(photo_id: str):
    if not face_service.is_available():
        raise HTTPException(503, '请安装可选 OpenCV 依赖并下载人脸模型')
    return face_service.detect_photo(photo_id)

@app.get('/api/faces/persons')
def list_face_persons():
    return face_service.persons()

@app.post('/api/faces/persons')
def create_face_person(payload: FacePersonCreate):
    with Session() as session:
        if session.scalar(select(FacePerson.id).where(FacePerson.name==payload.name)):raise HTTPException(409,'人物名称已存在')
        person = FacePerson(name=payload.name)
        session.add(person)
        session.commit()
        return {'id': person.id, 'name': person.name}

@app.patch('/api/faces/persons/{person_id}')
def rename_face_person(person_id: str, payload: FacePersonRename):
    with Session() as session:
        person = session.get(FacePerson, person_id)
        if not person: raise HTTPException(404, '人物不存在')
        if session.scalar(select(FacePerson.id).where(FacePerson.name==payload.name,FacePerson.id!=person_id)):raise HTTPException(409,'人物名称已存在')
        person.name = payload.name
        session.commit()
        return {'id': person.id, 'name': person.name}

@app.delete('/api/faces/persons/{person_id}')
def delete_face_person(person_id: str):
    with Session() as session:
        person = session.get(FacePerson, person_id)
        if not person: raise HTTPException(404, '人物不存在')
        from .models import DetectedFace
        for face in session.scalars(select(DetectedFace).where(DetectedFace.person_id==person_id)):
            face.person_id=None;face.confirmed=False
        session.delete(person)
        session.commit()
        return {'ok': True}

@app.get('/api/settings')
def get_settings(): return settings() | {'data_dir':str(DATA),'models_dir':str(MODELS),'exports_dir':str(EXPORTS),'scan_paths':SCAN_PATHS}


@app.get('/api/library/paths')
def get_library_paths(): return storage_paths()


@app.put('/api/library/paths')
def update_library_paths(payload: StoragePathsRequest):
    try: return save_storage_paths(payload.model_dump())
    except OSError as error: raise HTTPException(400,f'目录或配置文件不可写：{error}') from error


@app.delete('/api/library/paths')
def cancel_library_paths():
    try: return cancel_storage_paths()
    except OSError as error: raise HTTPException(400,f'无法取消目录修改：{error}') from error

@app.put('/api/settings')
def put_settings(payload: SettingsRequest): return save_settings(payload.model_dump())

@app.post('/api/backup')
def backup():
    import sqlite3
    filename = f'library-backup-{uuid4().hex[:12]}.db'
    with closing(sqlite3.connect(DATA/'library.db')) as source, closing(sqlite3.connect(DATA/'exports'/filename)) as dest:
        source.backup(dest)
    return {'url':'/api/exports/'+filename,'file_name':filename}

dist = PROJECT / 'frontend' / 'dist'
if dist.exists():
    @app.get('/watermark')
    @app.get('/watermark/workshop')
    @app.get('/watermark/gallery')
    @app.get('/timeline')
    @app.get('/compare')
    @app.get('/faces')
    def frontend_page():
        return FileResponse(dist / 'index.html')

    app.mount('/', StaticFiles(directory=dist, html=True), name='frontend')
