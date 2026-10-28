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
from .schemas import PhotoQueryRequest
from .schemas import AlbumDeleteRequest
from .schemas import AnnotationResult
from .services import album_service
from .services import rating_service

@asynccontextmanager
async def lifespan(_app: FastAPI):
    initialize()
    from .models import LibraryProfile
    with Session() as session:runtime_control.bind_library(session.get(LibraryProfile,1).library_id)
    jobs.recover()
    if AUTOLOAD_AI and any(MODELS.glob('models--OFA-Sys--chinese-clip-vit-base-patch16/snapshots/*')):
        ai.start(False)
    scan_service.start_monitor()
    try:yield
    finally:scan_service.stop_monitor()

from backend.version import VERSION,build_id
BUILD_ID=build_id()
app = FastAPI(title='光影集 · 本地摄影照片管理', version=VERSION, lifespan=lifespan)
from .watermark_drafts import router as draft_router
app.include_router(draft_router)
from .face_routes import router as face_router
app.include_router(face_router)
from .art_routes import router as art_router
app.include_router(art_router)
from .ai_routes import router as ai_router
app.include_router(ai_router)
from .vision_routes import router as vision_router
app.include_router(vision_router)
from .mcp_routes import router as mcp_router
app.include_router(mcp_router)
from .editor_routes import router as editor_router
app.include_router(editor_router)
from .collage_routes import router as collage_router
app.include_router(collage_router)
from .collage_output_routes import router as collage_output_router
app.include_router(collage_output_router)
from .lut_routes import router as lut_router
app.include_router(lut_router)
from .display_routes import router as display_router
app.include_router(display_router)
from .workspace_routes import router as workspace_router
app.include_router(workspace_router)
from .file_action_routes import router as file_action_router
app.include_router(file_action_router)
from .video_routes import router as video_router
app.include_router(video_router)
from .similarity_routes import router as similarity_router
app.include_router(similarity_router)
from .location_routes import router as location_router
app.include_router(location_router)
from .raw_source_routes import router as raw_source_router
app.include_router(raw_source_router)
from .removal_routes import router as removal_router
app.include_router(removal_router)
from .source_routes import router as source_router
app.include_router(source_router)
from .asset_routes import router as asset_router
app.include_router(asset_router)
from .frame_routes import router as frame_router
app.include_router(frame_router)
from .catalog_routes import router as catalog_router
from . import runtime_control
app.include_router(catalog_router)
app.add_middleware(CORSMiddleware, allow_origins=['http://localhost:5173','http://127.0.0.1:5173','http://localhost:8000','http://127.0.0.1:8000'], allow_methods=['GET','POST','PATCH','DELETE','PUT'], allow_headers=['Content-Type','X-PhotoCollection-Session','X-PhotoCollection-Library'], expose_headers=['X-PhotoCollection-Session','X-PhotoCollection-Library'])

# Keep these exact-host rules aligned with edgeone.json. Google resources are
# allowed only in the sandboxed satellite document, never in the library UI.
# Source: https://developers.google.com/maps/domains (reviewed 2026-10-28).
SATELLITE_CSP = "default-src 'none'; script-src 'self' 'unsafe-eval' https://maps.googleapis.com https://maps.gstatic.com blob:; worker-src blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https://maps.googleapis.com https://mapsresources-pa.googleapis.com https://maps.gstatic.com https://khm.google.com https://khm.googleapis.com https://khm0.google.com https://khm0.googleapis.com https://khm1.google.com https://khm1.googleapis.com https://khms0.google.com https://khms0.googleapis.com https://khms1.google.com https://khms1.googleapis.com https://khms2.google.com https://khms2.googleapis.com https://khms3.google.com https://khms3.googleapis.com; connect-src https://maps.googleapis.com https://mapsresources-pa.googleapis.com https://maps.gstatic.com https://csi.gstatic.com https://khm.google.com https://khm.googleapis.com https://khm0.google.com https://khm0.googleapis.com https://khm1.google.com https://khm1.googleapis.com https://khms0.google.com https://khms0.googleapis.com https://khms1.google.com https://khms1.googleapis.com https://khms2.google.com https://khms2.googleapis.com https://khms3.google.com https://khms3.googleapis.com; font-src https://fonts.gstatic.com; frame-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'none'"
SATELLITE_HEADERS = {
    '/maps/satellite.' + extension: {
        'Cross-Origin-Embedder-Policy': 'unsafe-none',
        'X-Frame-Options': 'SAMEORIGIN',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Content-Security-Policy': SATELLITE_CSP,
        'Cache-Control': 'no-cache',
    }
    for extension in ('html', 'js', 'css')
}

@app.middleware('http')
async def protect_local_requests(request: Request, call_next):
    origin = request.headers.get('origin')
    allowed = {'http://localhost:5173','http://127.0.0.1:5173','http://localhost:8000','http://127.0.0.1:8000'}
    forwarded = any(name == 'forwarded' or name.startswith('x-forwarded-') or name in {'x-real-ip', 'cf-connecting-ip', 'cf-connecting-ipv6', 'tailscale-funnel-request'} for name in request.headers)
    if request.url.hostname not in {'localhost', '127.0.0.1', '::1', 'testserver'}:
        response = JSONResponse({'detail':'仅支持本机访问'}, status_code=400)
    elif forwarded:
        response = JSONResponse({'detail':'本机照片服务不接受代理转发'}, status_code=403)
    elif request.method not in ('GET','HEAD','OPTIONS') and origin and origin not in allowed and origin != str(request.base_url).rstrip('/'):
        response = JSONResponse({'detail':'禁止来自其他网站的本地操作'}, status_code=403)
    elif request.url.path.startswith('/api/') and (request.headers.get('x-photocollection-session',runtime_control.session_id)!=runtime_control.session_id or request.query_params.get('pc_session',runtime_control.session_id)!=runtime_control.session_id or runtime_control.library_id is not None and request.headers.get('x-photocollection-library',runtime_control.library_id)!=runtime_control.library_id):
        response=JSONResponse({'detail':'图库已切换，请刷新页面后继续'},status_code=409)
    else:
        mutation=request.url.path.startswith('/api/') and request.method not in ('GET','HEAD','OPTIONS')
        switching=mutation and request.url.path=='/api/workspace/catalogs/activate'
        entered=False;reserved=False
        try:
            if switching:runtime_control.begin_switch();reserved=True
            elif mutation:runtime_control.enter_mutation();entered=True
            response=await call_next(request)
            if switching and response.status_code>=400:runtime_control.release_switch()
        except ValueError as error:
            if reserved:runtime_control.release_switch()
            response=JSONResponse({'detail':str(error)},status_code=409)
        except Exception:
            if switching:runtime_control.release_switch()
            raise
        finally:
            if entered:runtime_control.leave_mutation()
    response.headers['X-Content-Type-Options'] = 'nosniff'
    if request.url.path.startswith('/api/'):
        response.headers['X-PhotoCollection-Session']=runtime_control.session_id
        if runtime_control.library_id:response.headers['X-PhotoCollection-Library']=runtime_control.library_id
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['Cross-Origin-Opener-Policy'] = 'same-origin'
    response.headers['Cross-Origin-Embedder-Policy'] = 'require-corp'
    if response.headers.get('content-type', '').startswith('text/html') and request.url.path not in ('/docs', '/redoc', '/docs/oauth2-redirect'):
        response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://ibasemaps-api.arcgis.com https://api.maptiler.com; media-src 'self' blob:; connect-src 'self' https://ibasemaps-api.arcgis.com https://api.maptiler.com; object-src 'none'; frame-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
    if request.url.path.startswith('/assets/vision-worker-'):
        response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; object-src 'none'"
    if request.url.path in {'/raw-1.6.0/'+name for name in ('index.js','worker.js','libraw.js','libraw.wasm')}:
        response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'; object-src 'none'"
    if request.url.path in SATELLITE_HEADERS:
        # Only the sandboxed map document and its two public assets opt out of
        # COEP. The application and private-media routes stay isolated.
        response.headers.update(SATELLITE_HEADERS[request.url.path])
    return response

@app.exception_handler(ValueError)
async def value_error(_request: Request, error: ValueError):
    return JSONResponse({'detail': str(error)}, status_code=400)

from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler

@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, error: RequestValidationError):
    if request.url.path.startswith('/api/editor/'):
        return JSONResponse({'detail':'编辑参数无效，请检查源文件和参数'},status_code=422)
    if request.url.path.startswith('/api/ai/') or request.url.path == '/api/workspace/settings-transfer':
        return JSONResponse({'detail':'Invalid AI configuration or settings package.'},status_code=422)
    if request.url.path == '/api/art/settings':
        # Pydantic error inputs can contain submitted credentials; never echo them to the UI.
        return JSONResponse({'detail': 'Invalid AI settings; check model names and API key format'}, status_code=422)
    return await request_validation_exception_handler(request, error)

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
def picker(kind: Literal['files','videos','directory','catalog','lut-directory']):
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
    return jobs.submit('import', import_service.import_paths, paths, False, False, True)

@app.get('/api/jobs')
def recent_jobs(summary: bool = False):
    return jobs.recent(summary=summary)

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

@app.get('/api/jobs/{job_id}/children')
def job_children(job_id: str, page: int = 1, page_size: int = 20):
    if page<1 or not 1<=page_size<=100:raise ValueError('分页参数超出范围')
    if not jobs.get(job_id):raise HTTPException(404,'任务不存在或服务已重启')
    return jobs.children(job_id,page,page_size)

@app.get('/api/tasks/resources')
def task_resources():
    return jobs.resources()

def ordered_photos(request: Request, sort: str, direction: str):
    from .services.photo_order import ordered
    q = library_service.query_photos(filters(request), 'capture')
    if q.get_execution_options().get('pc_text_query'):
        from .services.text_index import schedule
        schedule()
    return ordered(q, sort, direction, q.get_execution_options().get('pc_album_id'))

@app.get('/api/photos')
def get_photos(request: Request, page: int = 1, page_size: int = 80, sort: str = 'date_taken', direction: str = 'desc'):
    if page < 1 or not 1 <= page_size <= 200: raise ValueError('分页参数超出范围')
    q = ordered_photos(request, sort, direction)
    with Session() as session:
        total = session.scalar(select(func.count()).select_from(q.order_by(None).subquery()))
        photos = session.scalars(q.offset((page-1)*page_size).limit(page_size)).all()
        return {'photos':library_service.serialize(session, photos), 'total':total, 'page':page, 'page_size':page_size}

@app.get('/api/facets/{field}')
def facet_options(field: str,request: Request,q: str='',page: int=1,page_size: int=60,count_mode: str='capture'):
    from .services.facet_service import options
    return options(filters(request),field,q,page,page_size,count_mode)


@app.get('/api/filter-options')
def filter_options(request: Request,include_tags: bool=True):
    values=filters(request);values.pop('include_tags',None);base=library_service.query_photos(values).with_only_columns(Photo.id).order_by(None).correlate(None) if values else None
    with Session() as session:
        result = {}
        for field in ['camera_model','lens_model','focal_length','f_number','iso','exposure_seconds']:
            column = getattr(Photo, field);statement=select(column).where(column.is_not(None))
            if base is not None:statement=statement.where(Photo.id.in_(base))
            result[field] = list(session.scalars(statement.distinct().order_by(column)))
        if include_tags:
            tags=select(Tag.name)
            if base is not None:tags=tags.join(PhotoTag).where(PhotoTag.photo_id.in_(base)).distinct()
            result['tags'] = list(session.scalars(tags.order_by(Tag.name)))
        return result

@app.get('/api/tags')
def search_tags(request: Request,q: str='',page: int=1,page_size: int=60,order: str='name'):
    from .services.tag_service import options
    return options(filters(request),q,page,page_size,order)

@app.get('/api/photos/ids')
def photo_ids(request: Request, sort: str = 'date_taken', direction: str = 'desc'):
    q = ordered_photos(request, sort, direction).with_only_columns(Photo.id)
    with Session() as session:
        return {'ids': list(session.scalars(q))}

@app.get('/api/search/parse')
def search_parse(q: str):
    with Session() as session:
        return nl_search.parse(q, session)

@app.get('/api/search/index')
def text_index_status():
    from .services.text_index import status
    return status()

@app.post('/api/search/index/rebuild')
def text_index_rebuild():
    from .services.text_index import schedule
    return schedule(True)

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

@app.post('/api/photos/{photo_id}/rating/refresh')
def refresh_photo_rating(photo_id: str):
    return rating_service.refresh(photo_id)

@app.patch('/api/photos/{photo_id}')
def update_photo(photo_id: str, payload: PhotoUpdate):
    with Session() as session:
        photo = photo_or_404(session, photo_id)
        if 'user_description' in payload.model_fields_set:photo.user_description=payload.user_description.strip() if payload.user_description is not None else None
        if payload.favorite is not None: photo.favorite = payload.favorite
        if 'flag' in payload.model_fields_set:photo.flag=payload.flag or 'unmarked'
        if 'rating' in payload.model_fields_set: photo.rating = payload.rating;photo.rating_source='manual'
        if payload.color_label is not None:
            photo.color_label = None if payload.color_label == 'none' else payload.color_label
        if payload.tags is not None: library_service.set_tags(session, photo, payload.tags)
        if payload.add_tags or payload.remove_tags or payload.restore_ai_tags:
            from .services.annotation_service import edit_tags
            edit_tags(session,photo,additions=payload.add_tags or [],removals=payload.remove_tags or [],restore=payload.restore_ai_tags or [])
        photo.updated_at = now()
        session.commit()
        return library_service.serialize(session, [photo], True)[0]

@app.post('/api/photos/{photo_id}/annotation')
def save_photo_annotation(photo_id: str, payload: AnnotationResult):
    from .services.annotation_service import save_result
    with Session() as session:
        photo=photo_or_404(session,photo_id)
        save_result(session,photo,payload)
        session.commit()
        return library_service.serialize(session,[photo],True)[0]

@app.post('/api/photos/batch-edit')
def batch_edit_photos(payload: BatchEditRequest):
    with Session() as session:
        photos = session.scalars(select(Photo).where(Photo.id.in_(payload.photo_ids))).all()
        if not photos: raise HTTPException(404, '未找到照片')
        for photo in photos:
            if 'user_description' in payload.model_fields_set:photo.user_description=payload.user_description.strip() if payload.user_description is not None else None
            if 'flag' in payload.model_fields_set:photo.flag=payload.flag or 'unmarked'
            if payload.favorite is not None: photo.favorite = payload.favorite
            if payload.rating is not None: photo.rating = payload.rating;photo.rating_source='manual'
            if payload.clear_rating: photo.rating = None;photo.rating_source='manual'
            if payload.color_label is not None:
                photo.color_label = None if payload.color_label == 'none' else payload.color_label
            if payload.clear_color_label: photo.color_label = None
            if payload.add_tags or payload.remove_tags:
                from .services.annotation_service import edit_tags
                edit_tags(session,photo,additions=payload.add_tags or [],removals=payload.remove_tags or [])
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
    elif sys.platform == 'darwin': subprocess.Popen(['open', '-R', str(path)])
    else: subprocess.Popen(['xdg-open', str(path.parent)])
    return {'path':str(path)}

@app.post('/api/photos/{photo_id}/open')
def open_photo(photo_id: str):
    with Session() as session:
        path = Path(photo_or_404(session, photo_id).file_path)
    if not path.exists(): raise HTTPException(404,'原图已移动或删除')
    if os.name == 'nt': os.startfile(str(path))
    elif sys.platform == 'darwin': subprocess.Popen(['open', str(path)])
    else: subprocess.Popen(['xdg-open', str(path)])
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
    return stats_service.lens_lifecycle(lens_name, count_mode(request), filters(request))

@app.get('/api/reports/lenses/{lens_name}/monthly')
def lens_month(lens_name: str, request: Request, year: int, month: int):
    return stats_service.report(year, month, filters(request) | {'lens_model':lens_name}, count_mode(request))

@app.get('/api/reports/lenses/{lens_name}/yearly')
def lens_year(lens_name: str, request: Request, year: int):
    return stats_service.report(year, None, filters(request) | {'lens_model':lens_name}, count_mode(request))

def album_dict(session, album: Album) -> dict:
    return album_service.summaries(session,[album])[0]

@app.get('/api/albums')
def albums():
    with Session() as session:
        return album_service.summaries(session,list(session.scalars(select(Album).order_by(Album.created_at.desc()))))

@app.post('/api/albums/batch-delete')
def delete_albums(payload: AlbumDeleteRequest):
    with Session() as session:return album_service.remove(session,payload.ids)

@app.get('/api/albums/{album_id}/recent')
def album_recent(album_id: str,page: int=1,page_size: int=24):
    if page<1 or not 1<=page_size<=100:raise ValueError('分页参数超出范围')
    with Session() as session:
        album=session.get(Album,album_id)
        if not album:raise HTTPException(404,'影集不存在')
        return album_service.recent_photos(session,album,page,page_size)

@app.post('/api/albums/smart/preview')
def smart_preview(payload: SmartRequest):
    matches = ai.search(payload.keywords, payload.match_mode, payload.threshold, payload.max_results)
    with Session() as session:
        ids = [m['photo_id'] for m in matches]
        photos = session.scalars(select(Photo).where(Photo.id.in_(ids))).all()
        records = {p['id']:p for p in library_service.serialize(session, photos)}
        return {'model':ai.model_name,'model_revision':ai.model_revision,'candidates':[records[m['photo_id']] | {'similarity_score':m['similarity_score']} for m in matches if m['photo_id'] in records]}

@app.post('/api/albums/rules/preview')
def rule_preview(payload: PhotoQueryRequest):
    from .services.photo_order import ordered
    q=library_service.query_photos({'query':payload.query})
    with Session() as session:
        total=session.scalar(select(func.count()).select_from(q.subquery()))
        photos=session.scalars(ordered(q,'date_taken','desc').limit(12)).all()
        return {'total':total,'candidates':library_service.serialize(session,photos)}

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
        album = Album(**payload.model_dump(exclude={'photo_ids','scores'}), ai_model=ai.model_name if payload.type=='smart' else None)
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
        album_service.remove(session,[album_id]);return {'ok':True}

@app.post('/api/albums/{album_id}/rerun')
def rerun_album(album_id: str):
    with Session() as session:
        album = session.get(Album,album_id)
        if not album or album.type != 'smart': raise HTTPException(404,'智能影集不存在')
        payload = SmartRequest(keywords=album.keywords, match_mode=album.match_mode, threshold=album.threshold, max_results=album.max_results)
    result=smart_preview(payload)
    with Session() as session:
        # Re-matching is a read-only proposal. Keep previously confirmed members
        # visible and selected, including manual additions below the threshold.
        if not session.get(Album,album_id):raise HTTPException(404,'智能影集不存在')
        previous=session.scalars(select(Photo).join(AlbumPhoto,AlbumPhoto.photo_id==Photo.id).where(
            AlbumPhoto.album_id==album_id).order_by(AlbumPhoto.position,Photo.id)).all()
        retained=library_service.serialize(session,previous)
        seen={p.capture_group_id for p in previous}
        scores={p['capture_group_id']:p.get('similarity_score') for p in result['candidates']}
        for row in retained:
            score=scores.get(row['capture_group_id'])
            if score is not None:row['similarity_score']=score
        result['candidates']=retained+[p for p in result['candidates'] if p['capture_group_id'] not in seen]
        result['selected_photo_ids']=[p.id for p in previous]
        return result

@app.put('/api/albums/{album_id}/photos')
def replace_album_photos(album_id: str, payload: AlbumRequest):
    with Session() as session:
        album = session.get(Album,album_id)
        if not album: raise HTTPException(404,'影集不存在')
        if album.type=='rule':raise ValueError('条件集合按规则更新，请编辑条件')
        previous={m.photo_id:m for m in session.scalars(select(AlbumPhoto).where(AlbumPhoto.album_id==album_id))}
        existing = set(session.scalars(select(Photo.id).where(Photo.id.in_(payload.photo_ids))))
        for photo_id,member in previous.items():
            if photo_id not in existing:session.delete(member)
        for photo_id in existing:
            if photo_id in previous:
                if photo_id in payload.scores:previous[photo_id].similarity_score=payload.scores[photo_id]
            else:session.add(AlbumPhoto(album_id=album_id,photo_id=photo_id,similarity_score=payload.scores.get(photo_id)))
        album.updated_at=now()
        album.name=payload.name
        session.commit()
        return album_dict(session,album)

@app.patch('/api/albums/{album_id}')
def update_album(album_id: str, payload: AlbumUpdate):
    with Session() as session:
        album = session.get(Album,album_id)
        if not album: raise HTTPException(404,'影集不存在')
        if payload.name is not None:album.name=payload.name
        if 'query' in payload.model_fields_set:
            if album.type!='rule':raise ValueError('普通影集和语义影集不能改为条件集合')
            album.query=payload.query
        if payload.person_id is not None:
            if album.type!='normal':raise ValueError('人物影集请使用普通影集')
            if not session.get(FacePerson,payload.person_id):raise HTTPException(404,'人物不存在')
            if album.person_id not in (None,payload.person_id):raise HTTPException(409,'影集已关联其他人物')
            album.person_id=payload.person_id
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
        if album.type=='rule':raise ValueError('条件集合按规则更新，请编辑条件')
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
def watermark_signature(style: Literal['natural', 'fine', 'brush', 'calligraphy', 'chinese_brush', 'chinese_running', 'chinese_cursive', 'chinese_handwriting']):
    from .watermark.signatures import signature_image
    image = signature_image({'fields':['signature'], 'signature':'光影' if style.startswith('chinese_') else 'wonder', 'signature_style':style})
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
    return timeline_service.get_timeline_hierarchy(count_mode(request),filters(request))


@app.get('/api/timeline/unknown')
def timeline_unknown(request: Request, page: int = 1, page_size: int = 80):
    return timeline_service.unknown_photos(count_mode=count_mode(request),filters=filters(request),page=page,page_size=page_size)

@app.get('/api/timeline/heatmap/{year}')
def timeline_heatmap(year: int, request: Request):
    return timeline_service.get_calendar_heatmap(year, count_mode(request),filters(request))

@app.get('/api/timeline/{year}')
def timeline_year(year: int, request: Request, page: int = 1, page_size: int = 80):
    return timeline_service.date_photos(year, page=page, page_size=page_size, count_mode=count_mode(request),filters=filters(request))

@app.get('/api/timeline/{year}/{month}')
def timeline_month(year: int, month: int, request: Request, page: int = 1, page_size: int = 80):
    return timeline_service.date_photos(year, month, page=page, page_size=page_size, count_mode=count_mode(request),filters=filters(request))

@app.get('/api/timeline/{year}/{month}/{day}')
def timeline_day(year: int, month: int, day: int, request: Request, page: int = 1, page_size: int = 80):
    return timeline_service.date_photos(year, month, day, page=page, page_size=page_size, count_mode=count_mode(request),filters=filters(request))

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
        from .services.face_management import active_person
        active_person(session,person_id)
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
        from .services.face_management import delete_person
        delete_person(session,person_id)
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
    @app.get('/watercolor')
    @app.get('/timeline')
    @app.get('/compare')
    @app.get('/faces')
    @app.get('/tools')
    @app.get('/tools/darkroom')
    @app.get('/tools/analyze')
    @app.get('/tools/raw')
    @app.get('/tools/edit')
    def frontend_page():
        return FileResponse(dist / 'index.html')

    app.mount('/local-assets/brand_logos', StaticFiles(directory=Path(__file__).parent/'assets'/'brand_logos'), name='local-brand-assets')
    app.mount('/local-assets/signatures', StaticFiles(directory=Path(__file__).parent/'assets'/'signatures'), name='local-signature-assets')
    app.mount('/', StaticFiles(directory=dist, html=True), name='frontend')
