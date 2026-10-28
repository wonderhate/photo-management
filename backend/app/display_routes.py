import asyncio
import threading
from typing import Literal
from fastapi import APIRouter, Request, Query, HTTPException
from fastapi.responses import Response
from .services import display_service, jobs

router=APIRouter(prefix='/api/display',tags=['local display'])


@router.get('/capabilities')
def capabilities():
    return {'engine':display_service.ENGINE,'formats':sorted(display_service.FORMATS),'isolated':True}


@router.post('/{photo_id}/render')
async def render(photo_id: str,request: Request,source_hash: str=Query(pattern=r'^[a-f0-9]{64}$'),edge: Literal['4096','6144']='4096'):
    cancelled=threading.Event()
    async def watch():
        while not cancelled.is_set():
            if await request.is_disconnected():cancelled.set();return
            await asyncio.sleep(.03)
    monitor=asyncio.create_task(watch())
    try:
        data=await asyncio.to_thread(display_service.render,photo_id,source_hash,int(edge),cancelled)
        return Response(data,media_type='image/jpeg',headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Display-Engine':display_service.ENGINE})
    except jobs.JobCancelled:raise HTTPException(499,'高清预览已取消')
    finally:
        cancelled.set();monitor.cancel()
        try:await monitor
        except asyncio.CancelledError:pass
