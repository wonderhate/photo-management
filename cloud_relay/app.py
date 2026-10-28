"""Bounded, explicit-request Qwen relay. Never imports the photo database or credentials."""
import asyncio
import base64
import json
import os
import re
from contextlib import suppress
from io import BytesIO
from time import monotonic
from typing import Literal

import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from PIL import Image
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from backend.app.services.qwen_protocol import SCENE_PROMPT, provider_error, validate_image_url, title_instructions
from backend.app.art_schemas import TitleSuggestions

ENDPOINT = 'https://maas.qianwenaiapi.com/api/v1/services/aigc/multimodal-generation/generation'
MAX_IMAGE = 8 * 1024 * 1024
MAX_JSON = 48 * 1024 * 1024
CHUNK = 64 * 1024


class Request(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    action: Literal['generate', 'titles']
    api_key: str = Field(min_length=1, max_length=2048, repr=False)
    model: str = Field(min_length=1, max_length=100)
    quality: Literal['low', 'medium', 'high'] = 'medium'
    description: str = Field(default='', max_length=1500)
    keywords: str = Field(default='', max_length=200)
    language: Literal['zh', 'en'] = 'zh'
    image_size: int = Field(ge=32, le=MAX_IMAGE)

    @field_validator('api_key')
    @classmethod
    def clean_key(cls, value):
        if any(ord(c) <= 32 or ord(c) >= 127 for c in value):
            raise ValueError('Invalid key format')
        return value

    @field_validator('model')
    @classmethod
    def qwen_only(cls, value, info):
        import re
        pattern = r'qwen-image-3\.0(?:-pro)?' if info.data.get('action') == 'generate' else r'qwen[\w.-]{1,95}'
        if not re.fullmatch(pattern, value):
            raise ValueError('Unsupported model')
        return value


def clean_image(raw: bytes) -> tuple[bytes, tuple[int, int], str]:
    try:
        with Image.open(BytesIO(raw)) as image:
            if image.format not in ('PNG', 'JPEG', 'WEBP') or max(image.size) > 1536:
                raise ValueError('Unsupported AI image format or dimensions')
            image.load()
            clean = Image.new('RGB', image.size, 'white')
            clean.paste(image.convert('RGB'))
            output = BytesIO()
            clean.save(output, 'PNG')  # No source metadata is copied.
            data = output.getvalue()
            if len(data) > MAX_IMAGE:
                raise ValueError('AI image exceeds the relay 8 MiB limit')
            return data, clean.size, 'image/png'
    except (OSError, Image.DecompressionBombError):
        raise ValueError('The AI image could not be decoded') from None


def payload(request: Request, raw: bytes, size: tuple[int, int]) -> dict:
    image = 'data:image/png;base64,' + base64.b64encode(raw).decode('ascii')
    if request.action == 'generate':
        prompt = SCENE_PROMPT + ('\n用户补充画风要求（仍需保留原场景）：' + request.description if request.description else '')
        parameters = {'n': 1, 'size': f'{size[0]}*{size[1]}', 'watermark': False,
                      'prompt_extend': request.quality != 'low', 'enable_thinking': request.quality == 'high'}
    else:
        prompt = title_instructions(request.language) + '\nContext: ' + json.dumps({'user_keywords': request.keywords, 'language': request.language}, ensure_ascii=False)
        parameters = {'max_tokens': 700}
    return {'model': request.model, 'input': {'messages': [{'role': 'user', 'content': [{'image': image}, {'text': prompt}]}]}, 'parameters': parameters}


async def read_limited(response: httpx.Response, maximum: int):
    data = bytearray()
    async for part in response.aiter_bytes():
        data.extend(part)
        if len(data) > maximum:
            raise ValueError('The provider response exceeds the size limit')
    return bytes(data)


async def request_provider(request: Request, raw: bytes, size: tuple[int, int], client: httpx.AsyncClient):
    async with asyncio.timeout(600):
        async with client.stream('POST', ENDPOINT, headers={'Authorization': 'Bearer ' + request.api_key}, json=payload(request, raw, size)) as response:
            data = await read_limited(response, MAX_JSON if response.is_success else 65536)
            if not response.is_success:
                # Never include provider text, headers or a validation input in errors.
                try:
                    detail = json.loads(data)
                except (ValueError, UnicodeError):
                    detail = {}
                raise provider_error(response.status_code, detail if isinstance(detail, dict) else {})
            try:
                result = json.loads(data)
                if not isinstance(result, dict):
                    raise ValueError()
                if result.get('error') or result.get('code'):
                    raise provider_error(response.status_code, result)
                return result
            except (json.JSONDecodeError, UnicodeError):
                raise ValueError('The provider returned invalid JSON') from None


async def result_image(value: str, client: httpx.AsyncClient, size: tuple[int, int]):
    if value.startswith(('data:image/png;base64,', 'data:image/jpeg;base64,', 'data:image/webp;base64,')):
        if len(value) > MAX_JSON:
            raise ValueError('The provider image exceeds the size limit')
        raw = base64.b64decode(value.split(',', 1)[1], validate=True)
    else:
        validate_image_url(value)
        async with asyncio.timeout(60):
            # Authorization is supplied only on the POST, never on image downloads.
            async with client.stream('GET', value) as response:
                if response.status_code != 200:
                    raise ValueError('The generated image could not be downloaded')
                raw = await read_limited(response, MAX_JSON)
    data, actual, mime = await asyncio.to_thread(clean_image, raw)
    if actual != size:
        raise ValueError('AI output dimensions differ from the requested size; no crop or stretch was applied')
    return data, mime


def create_app(origin: str | None = None, provider=request_provider) -> FastAPI:
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    allowed = origin if origin is not None else os.environ.get('PHOTO_RELAY_ORIGIN', '')
    slots = asyncio.Semaphore(2)

    @app.get('/health')
    async def health():
        return {'status': 'ready' if allowed else 'origin_not_configured'}

    @app.websocket('/cloud-art')
    async def relay(ws: WebSocket):
        if not allowed or ws.headers.get('origin') != allowed or ws.url.query:
            await ws.close(code=1008)
            return
        await ws.accept()
        acquired = False
        heartbeat = None
        submitted = False
        request_id = ''
        try:
            async with asyncio.timeout(880):
                metadata = await asyncio.wait_for(ws.receive_text(), 10)
                if len(metadata) > 16384:
                    raise ValueError('Cloud request metadata is too large')
                try:
                    request = Request.model_validate_json(metadata)
                except ValidationError:
                    raise ValueError('Invalid cloud request metadata') from None
                try:
                    await asyncio.wait_for(slots.acquire(), .1)
                    acquired = True
                except TimeoutError:
                    raise ValueError('Relay is busy; no generation was submitted') from None
                raw = bytearray()
                while len(raw) < request.image_size:
                    part = await asyncio.wait_for(ws.receive_bytes(), 15)
                    if not part or len(part) > CHUNK or len(raw) + len(part) > request.image_size:
                        raise ValueError('Invalid image chunk')
                    raw.extend(part)
                if await asyncio.wait_for(ws.receive_json(), 10) != {'type': 'submit'}:
                    raise ValueError('Explicit cloud submission is required')
                clean, size, _mime = await asyncio.to_thread(clean_image, bytes(raw))
                async def keep_alive():
                    while True:
                        await asyncio.sleep(20)
                        await ws.send_json({'type': 'waiting'})

                heartbeat = asyncio.create_task(keep_alive())
                started = monotonic()
                submitted = True
                async with httpx.AsyncClient(timeout=httpx.Timeout(600, connect=20), follow_redirects=False, trust_env=False) as client:
                    result = await provider(request, clean, size, client)
                    candidate = result.get('request_id')
                    if isinstance(candidate,str) and request.api_key not in candidate and re.fullmatch(r'[a-zA-Z0-9._:-]{1,200}',candidate):
                        request_id = candidate
                    try:
                        contents = result['output']['choices'][0]['message']['content']
                        if request.action == 'titles':
                            text = ''.join(item['text'] for item in contents if 'text' in item).strip()
                            if text.startswith('```'):
                                text = text.split('\n', 1)[1].rsplit('```', 1)[0]
                            suggestions = TitleSuggestions.model_validate_json(text).model_dump()['suggestions']
                            await ws.send_json({'type': 'result', 'request_id': request_id, 'suggestions': suggestions})
                        else:
                            image, mime = await result_image(next(item['image'] for item in contents if item.get('image')), client, size)
                            await ws.send_json({'type': 'result', 'request_id': request_id, 'mime': mime, 'seconds': round(monotonic() - started, 1)})
                            for offset in range(0, len(image), CHUNK):
                                await ws.send_bytes(image[offset:offset + CHUNK])
                                await asyncio.sleep(.7)
                    except (KeyError, IndexError, TypeError, StopIteration, ValidationError):
                        raise ValueError('The provider returned an invalid result') from None
                await ws.send_json({'type': 'done'})
        except WebSocketDisconnect:
            pass
        except (TimeoutError, httpx.HTTPError):
            with suppress(Exception):
                await ws.send_json({'type': 'error', 'request_id': request_id, 'message': 'Connection timed out or failed. Result and billing status may be unknown. No automatic retry.'})
        except ValueError as error:
            with suppress(Exception):
                await ws.send_json({'type': 'error', 'request_id': request_id, 'message': str(error)})
        except Exception:
            with suppress(Exception):
                await ws.send_json({'type': 'error', 'message': 'Relay failed. Result may be unknown; no automatic retry.' if submitted else 'Relay failed before submission.'})
        finally:
            if heartbeat:
                heartbeat.cancel()
                with suppress(asyncio.CancelledError, WebSocketDisconnect, RuntimeError):
                    await heartbeat
            if acquired:
                slots.release()
            with suppress(Exception):
                await ws.close()

    from .studio import attach_studio
    attach_studio(app,allowed,slots)
    return app


app = create_app()
