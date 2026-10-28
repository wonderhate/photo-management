import asyncio
import mimetypes
import os
import re
import threading
from pathlib import Path
from typing import Annotated, Literal
from fastapi import APIRouter, HTTPException, Request, Query, UploadFile, File
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, func
from .config import DATA
from .models import MediaAsset, Session, uid
from .services import jobs, video_service

router = APIRouter(prefix='/api/videos', tags=['local video'])


class VideoImport(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    paths: list[Annotated[str, Field(min_length=1, max_length=32768)]] = Field(min_length=1, max_length=1000)


class ProxyOptions(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    edge: Literal[720, 1080, 1920] = 1920
    tone_map: bool = True


@router.get('/capabilities')
def capabilities():
    return video_service.capabilities()


@router.get('')
def list_videos(page: int = Query(default=1,ge=1), size: int = Query(default=60,ge=1,le=120)):
    with Session() as session:
        rows=session.scalars(select(MediaAsset).order_by(MediaAsset.created_at.desc(), MediaAsset.id).offset((page-1)*size).limit(size)).all()
        return {'items':[video_service.serialize(row) for row in rows], 'total':session.scalar(select(func.count()).select_from(MediaAsset))}


@router.post('/import', status_code=202)
def import_videos(payload: VideoImport):
    return jobs.submit('video-import', video_service.import_paths, payload.paths, resource='io')


@router.post('/upload', status_code=202)
def upload_videos(files: list[UploadFile] = File(...)):
    if not 1 <= len(files) <= 100:
        raise HTTPException(422, 'Choose between 1 and 100 video files.')
    batch=(DATA/'imports'/uid()).resolve()
    if not batch.is_relative_to(DATA.resolve()):raise HTTPException(409,'Invalid import directory.')
    batch.mkdir(parents=True,exist_ok=False)
    paths=[]
    try:
        for upload in files:
            name=Path((upload.filename or '').replace('\\','/')).name
            if Path(name).suffix.lower() not in video_service.EXTENSIONS:
                raise HTTPException(422,'Unsupported video format.')
            # Each upload has its own directory, so duplicate names never overwrite.
            target=batch/uid()/name;target.parent.mkdir()
            size=0
            with target.open('xb') as stream:
                while chunk:=upload.file.read(1024*1024):
                    size+=len(chunk)
                    if size>video_service.MAX_SOURCE_BYTES:raise HTTPException(413,'Video exceeds the 32 GiB source limit.')
                    stream.write(chunk)
            paths.append(str(target))
        return jobs.submit('video-import',video_service.import_paths,paths,resource='io')
    finally:
        for upload in files:upload.file.close()


@router.get('/cache')
def cache_status():
    return video_service.cache_status()


@router.delete('/cache')
def clear_cache():
    return video_service.clear_cache()


@router.get('/{asset_id}')
def get_video(asset_id: str):
    with Session() as session:
        row=session.get(MediaAsset,asset_id)
        if not row:raise HTTPException(404,'Video not found.')
        return video_service.serialize(row)


@router.delete('/{asset_id}')
def remove_video(asset_id: str):
    with Session() as session:
        row=session.get(MediaAsset,asset_id)
        if not row:raise HTTPException(404,'Video not found.')
        session.delete(row);session.commit()
    return {'removed':asset_id,'originals_untouched':True}


@router.get('/{asset_id}/original')
def original(asset_id: str, download: bool=False):
    path,_,_=video_service.source(asset_id)
    return FileResponse(path,media_type=mimetypes.guess_type(path.name)[0] or 'application/octet-stream',
        filename=path.name,content_disposition_type='attachment' if download else 'inline',
        headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'})


@router.get('/{asset_id}/cover')
def cover(asset_id: str):
    with Session() as session:
        row=session.get(MediaAsset,asset_id)
        if not row:raise HTTPException(404,'Video not found.')
        path=Path(row.cover_path).resolve() if row.cover_path else None
        if not path or tuple(path.parts[-4:-1])!=('previews','videos','covers') or not re.fullmatch(r'[a-zA-Z0-9-]{1,80}\.jpg',path.name) or not path.is_file():
            raise HTTPException(404,'Video cover unavailable.')
    return FileResponse(path,media_type='image/jpeg',headers={'Cache-Control':'private, max-age=86400'})


@router.post('/{asset_id}/frame')
async def frame(asset_id: str,request: Request,index: int=Query(default=0,ge=0,le=7)):
    cancelled=threading.Event()
    async def watch():
        while not cancelled.is_set():
            if await request.is_disconnected():cancelled.set();return
            await asyncio.sleep(.05)
    monitor=asyncio.create_task(watch())
    try:
        data=await asyncio.to_thread(video_service.frame,asset_id,index,cancelled)
        return Response(data,media_type='image/jpeg',headers={'Cache-Control':'no-store'})
    except jobs.JobCancelled:raise HTTPException(499,'Video preview cancelled.')
    except ValueError as error:raise HTTPException(422,str(error)) from error
    finally:
        cancelled.set();monitor.cancel()
        try:await monitor
        except asyncio.CancelledError:pass


@router.post('/{asset_id}/proxy')
def create_proxy(asset_id: str,options: ProxyOptions):
    return video_service.request_proxy(asset_id,options.edge,options.tone_map)


@router.get('/{asset_id}/proxy')
def proxy(asset_id: str,edge: Literal['720','1080','1920']='1920',tone_map: bool=True):
    path=video_service.proxy_path(asset_id,int(edge),tone_map)
    if not path.is_file():raise HTTPException(404,'Compatibility video is not ready.')
    os.utime(path,None)
    return FileResponse(path,media_type='video/mp4',headers={'Cache-Control':'no-store'})
