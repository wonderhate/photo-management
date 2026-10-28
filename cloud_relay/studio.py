"""Optional browser AI Studio transport; no local library or credential imports."""
import asyncio
import base64
from contextlib import suppress
from io import BytesIO
import json
import re
from typing import Literal
import httpx
from fastapi import WebSocket,WebSocketDisconnect
from PIL import Image
from pydantic import Field,SecretStr,ValidationError
from backend.app.ai_schemas import Strict,Profile,AnnotationOptions
from backend.app.services import ai_protocol
from backend.app.services.qwen_protocol import validate_image_url


class StudioRequest(Strict):
    action: Literal['annotation','image']
    profile: Profile
    api_key: SecretStr
    image_size: int = Field(ge=0,le=8*1024*1024)
    prompt: str = Field(default='',max_length=5000)
    options: AnnotationOptions = Field(default_factory=AnnotationOptions)


def clean_output(raw):
    with Image.open(BytesIO(raw)) as image:
        if max(image.size)>8192 or image.width*image.height>40_000_000:raise ValueError('AI output dimensions exceed the supported limit.')
        image.load();clean=Image.new('RGB',image.size,'white');clean.paste(image.convert('RGB'));out=BytesIO();clean.save(out,'PNG')
        data=out.getvalue()
        if len(data)>32*1024*1024:raise ValueError('AI image exceeds 32 MiB.')
        return data


def attach_studio(app,allowed,slots):
    # Same configured Origin and resource ceiling as the existing watercolor relay.
    @app.websocket('/cloud-studio')
    async def relay(ws:WebSocket):
        from .app import clean_image,read_limited,CHUNK,MAX_JSON
        if not allowed or ws.headers.get('origin')!=allowed or ws.url.query:
            await ws.close(code=1008);return
        await ws.accept();acquired=False;heartbeat=None;request_id=''
        try:
            async with asyncio.timeout(880):
                metadata=await asyncio.wait_for(ws.receive_text(),10)
                if len(metadata)>16384:raise ValueError('Invalid AI metadata.')
                try:r=StudioRequest.model_validate_json(metadata)
                except ValidationError:raise ValueError('Invalid AI metadata.') from None
                key=r.api_key.get_secret_value()
                if not 10<=len(key)<=512 or any(c.isspace() for c in key) or r.profile.api_key is not None:raise ValueError('Invalid AI metadata.')
                await asyncio.wait_for(slots.acquire(),.1);acquired=True
                raw=bytearray()
                while len(raw)<r.image_size:
                    part=await asyncio.wait_for(ws.receive_bytes(),15)
                    if not part or len(part)>CHUNK or len(raw)+len(part)>r.image_size:raise ValueError('Invalid image chunk.')
                    raw.extend(part)
                if await asyncio.wait_for(ws.receive_json(),10)!={'type':'submit'}:raise ValueError('Explicit cloud submission is required.')
                image=None
                if raw:
                    clean,_,_=await asyncio.to_thread(clean_image,bytes(raw));image='data:image/png;base64,'+base64.b64encode(clean).decode()
                profile=r.profile.model_dump(exclude={'api_key','clear_key'})
                if r.action=='annotation' and not image:raise ValueError('Annotation requires a source image.')
                body=ai_protocol.annotation_request(profile,image,r.options.model_dump()) if r.action=='annotation' else ai_protocol.image_request(profile,r.prompt,image)
                async def beat():
                    while True:await asyncio.sleep(20);await ws.send_json({'type':'waiting'})
                heartbeat=asyncio.create_task(beat())
                async with httpx.AsyncClient(timeout=httpx.Timeout(600,connect=20),follow_redirects=False,trust_env=False) as client:
                    async with client.stream('POST',ai_protocol.endpoint(profile),headers={'Authorization':'Bearer '+key},json=body) as response:
                        candidate=response.headers.get('x-request-id') or response.headers.get('x-dashscope-request-id')
                        if isinstance(candidate,str) and key not in candidate and re.fullmatch(r'[a-zA-Z0-9._:-]{1,200}',candidate):request_id=candidate
                        data=await read_limited(response,MAX_JSON if response.is_success else 65536)
                        if not response.is_success:raise ValueError('Provider rejected the request; billing may be unknown. No automatic retry.')
                        result=json.loads(data)
                        if not isinstance(result,dict) or result.get('error') or result.get('code'):raise ValueError('Provider rejected the request. No automatic retry.')
                    id=result.get('request_id') or result.get('id') or ''
                    id=id if isinstance(id,str) and key not in id and re.fullmatch(r'[a-zA-Z0-9._:-]{1,200}',id) else ''
                    request_id=id or request_id;id=request_id
                    if r.action=='annotation':
                        raw_text=ai_protocol.response_text(result).replace(key,'[redacted]')
                        try:annotation=ai_protocol.normalized_annotation(raw_text,r.options.model_dump())
                        except ValueError:annotation=None
                        await ws.send_json({'type':'result','request_id':id,'result':annotation,'repair_text':raw_text[:64000] if annotation is None else ''})
                    else:
                        raw_image=ai_protocol.response_image(result,profile['provider'])
                        if isinstance(raw_image,str):
                            if raw_image.startswith(('data:image/png;base64,','data:image/jpeg;base64,','data:image/webp;base64,')):
                                if len(raw_image)>MAX_JSON:raise ValueError('Image response is too large.')
                                raw_image=base64.b64decode(raw_image.split(',',1)[1],validate=True)
                            else:
                                validate_image_url(raw_image)
                                async with client.stream('GET',raw_image) as response:
                                    if response.status_code!=200:raise ValueError('AI image download failed.')
                                    raw_image=await read_limited(response,MAX_JSON)
                        pixels=await asyncio.to_thread(clean_output,raw_image)
                        await ws.send_json({'type':'result','request_id':id,'mime':'image/png'})
                        for offset in range(0,len(pixels),CHUNK):await ws.send_bytes(pixels[offset:offset+CHUNK]);await asyncio.sleep(0)
                await ws.send_json({'type':'done'})
        except WebSocketDisconnect:pass
        except Exception:
            # Validation and provider exceptions can contain echoed request data.
            with suppress(Exception):await ws.send_json({'type':'error','request_id':request_id,'message':'AI request failed. Check the profile and account; billing may be unknown. No automatic retry.'})
        finally:
            if heartbeat:
                heartbeat.cancel()
                with suppress(asyncio.CancelledError,WebSocketDisconnect,RuntimeError):await heartbeat
            if acquired:slots.release()
            with suppress(Exception):await ws.close()
