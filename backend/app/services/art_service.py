"""One-image watercolor editing with deterministic local poster composition."""
import base64
import json
import re
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
from threading import RLock
from time import monotonic
from urllib.parse import urlsplit
import httpx
import numpy as np
from PIL import Image, ImageOps
from ..art_schemas import ArtLayout, ArtGenerate, ArtBatchGenerate, ArtTitleRequest, TitleSuggestions
from ..config import DATA, EXPORTS
from ..models import Artwork, Photo, Session, uid
from ..watermark.signatures import signature_image, paste_signature
from . import art_credentials, jobs, export_registry
from .thumbnail_service import open_image

pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='watercolor')
# ponytail: serialize local mutations; per-artwork locks only if multi-user use is introduced.
lock = RLock()
PROMPT_VERSION = 'travel-watercolor-v1'
API_URL = 'https://maas.qianwenaiapi.com/api/v1/services/aigc/multimodal-generation/generation'
from .qwen_protocol import SCENE_PROMPT, provider_error, validate_image_url, title_instructions

def source_photo(photo_id: str) -> Photo:
    with Session() as session:
        photo = session.get(Photo, photo_id)
        if not photo:
            raise ValueError('Source photo no longer exists')
        if not Path(photo.file_path).is_file():
            raise ValueError('Source file is missing; locate it before generating')
        return photo


def read_response(response, limit: int = 48 * 1024 * 1024) -> bytes:
    chunks, size = [], 0
    for chunk in response.iter_bytes():
        size += len(chunk)
        if size > limit:
            raise ValueError('AI response is too large')
        chunks.append(chunk)
    return b''.join(chunks)


def request_api(**kwargs) -> dict:
    """Use the supplied Qwen endpoint without retries, redirects or raw provider errors."""
    key = art_credentials.get_key()
    try:
        with httpx.Client(timeout=httpx.Timeout(600, connect=20), follow_redirects=False) as client:
            with client.stream('POST', API_URL,
                               headers={'Authorization': 'Bearer ' + key}, **kwargs) as response:
                raw = read_response(response, 64 * 1024 if not 200 <= response.status_code < 300 else 48 * 1024 * 1024)
                try:
                    result = json.loads(raw)
                except (json.JSONDecodeError, UnicodeDecodeError):
                    if not 200 <= response.status_code < 300:
                        raise provider_error(response.status_code, {}) from None
                    raise
                if not isinstance(result, dict):
                    raise ValueError('AI returned an invalid response')
                if not 200 <= response.status_code < 300 or result.get('code') or result.get('error'):
                    raise provider_error(response.status_code, result)
                return result
    except httpx.TimeoutException:
        raise ValueError('AI request timed out; it may still be billed. Check before retrying') from None
    except httpx.HTTPError:
        raise ValueError('无法连接千问服务，请检查网络；未自动重试。') from None
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise ValueError('AI returned an invalid response') from None


def generated_image(value: str) -> bytes:
    if not isinstance(value, str):
        raise ValueError('AI did not return a usable image')
    if re.match(r'^data:image/(png|jpeg|webp);base64,', value):
        if len(value) > 64 * 1024 * 1024:
            raise ValueError('AI response is too large')
        return base64.b64decode(value.split(',', 1)[1], validate=True)
    validate_image_url(value)
    try:
        # No Authorization header is sent to the generated-image host.
        with httpx.Client(timeout=httpx.Timeout(120, connect=20), follow_redirects=False) as client:
            with client.stream('GET', value) as response:
                if response.status_code != 200:
                    raise ValueError('千问图片下载失败，请重新生成或稍后重试。')
                return read_response(response)
    except httpx.HTTPError:
        raise ValueError('千问图片下载失败，请重新生成或稍后重试。') from None


def prepare_image(photo: Photo) -> tuple[bytes, tuple[int, int], tuple[int, int, int, int], tuple[int, int]]:
    image = open_image(Path(photo.file_path))
    original_size = image.size
    ratio = min(3, max(1 / 3, image.width / image.height))
    width = 1536 if ratio >= 1 else max(512, round(1536 * ratio / 16) * 16)
    height = 1536 if ratio <= 1 else max(512, round(1536 / ratio / 16) * 16)
    image = ImageOps.contain(image, (width, height), Image.Resampling.LANCZOS)
    canvas = Image.new('RGB', (width, height), (250, 247, 239))
    x, y = (width - image.width) // 2, (height - image.height) // 2
    canvas.paste(image, (x, y))
    output = BytesIO()
    # New image explicitly discards EXIF/GPS/ICC metadata from the cloud input.
    canvas.save(output, 'PNG')
    return output.getvalue(), canvas.size, (x, y, x + image.width, y + image.height), original_size


def poster(scene: Image.Image, original_size: tuple[int, int], layout: ArtLayout) -> Image.Image:
    width, height = original_size
    scale = min(1, 1536 / max(width, height))
    width, height = max(1, round(width * scale)), max(1, round(height * scale))
    paper = np.empty((height, width, 3), dtype=np.float32)
    paper[:] = (250, 247, 239)
    if layout.paper:
        noise = np.random.default_rng(42).normal(0, 3 * layout.paper, (height, width, 1))
        paper += noise
    canvas = Image.fromarray(np.clip(paper, 0, 255).astype(np.uint8))
    fraction = .55 if layout.layout == 'airy' else .85
    margin = max(1, round(min(width, height) * .05))
    title_height = max(1, round(min(width, height) * .047)) if layout.title else 0
    gap = max(1, round(min(width, height) * .025)) if layout.title else 0
    image = ImageOps.contain(scene, (max(1, round(width * fraction)), max(1, height - margin * 2 - title_height - gap)), Image.Resampling.LANCZOS)
    top = max(0, (height - image.height - title_height - gap) // 2)
    canvas.paste(image, ((width - image.width) // 2, top))
    if layout.title:
        signature = signature_image({'signature': layout.title, 'signature_style': layout.font, 'fields': ['signature']})
        paste_signature(canvas, signature, (margin, top + image.height + gap, width - margin * 2, title_height), '#393832', 'center')
    return canvas


def folder_for(art_id: str) -> Path:
    # IDs come from DB records, nevertheless keep filesystem operations within the derived directory.
    from uuid import UUID
    UUID(art_id)
    folder = (DATA / 'artworks' / art_id).resolve()
    if folder.parent != (DATA / 'artworks').resolve():
        raise ValueError('Invalid artwork path')
    return folder


def save_poster(folder: Path, image: Image.Image, revision: int) -> None:
    image.save(folder / f'poster-{revision}.png', 'PNG')
    preview = image.copy()
    preview.thumbnail((1000, 1000), Image.Resampling.LANCZOS)
    preview.save(folder / f'preview-{revision}.webp', 'WEBP', quality=90)


def serialize(art: Artwork) -> dict:
    return dict(id=art.id, photo_id=art.photo_id, source=art.source_json, layout=art.settings_json,
                generation=art.generation_json, width=art.width, height=art.height, revision=art.revision,
                created_at=art.created_at, preview_url=f'/api/art/works/{art.id}/preview?revision={art.revision}',
                scene_url=f'/api/art/works/{art.id}/scene', poster_url=f'/api/art/works/{art.id}/poster?revision={art.revision}')


def update_layout(session, item: Artwork, layout: ArtLayout) -> dict:
    folder = folder_for(item.id)
    with Image.open(folder / 'scene.png') as scene:
        image = poster(scene, (item.source_json['width'], item.source_json['height']), layout)
    revision = item.revision + 1
    try:
        save_poster(folder, image, revision)
        item.settings_json = layout.model_dump()
        item.revision = revision
        session.commit()
    except Exception:
        (folder / f'poster-{revision}.png').unlink(missing_ok=True)
        (folder / f'preview-{revision}.webp').unlink(missing_ok=True)
        raise
    return serialize(item)


def generate(job_id: str, payload: ArtGenerate, image_model: str, *, batch=False) -> dict:
    started = monotonic()
    photo = source_photo(payload.photo_id)
    jobs.update(job_id, current='准备转绘照片', **({} if batch else {'total': 1}))
    data, size, bounds, original_size = prepare_image(photo)
    jobs.check(job_id)
    jobs.update(job_id, current='等待水彩生成')
    prompt = SCENE_PROMPT + ('\n用户补充画风要求（仍需保留原场景）：' + payload.description if payload.description else '')
    if len(data) > 10 * 1024 * 1024:
        raise ValueError('转绘输入图片超过千问的 10 MB 限制。')
    parameters = {'n': 1, 'size': f'{size[0]}*{size[1]}', 'watermark': False,
                  'prompt_extend': payload.quality != 'low', 'enable_thinking': payload.quality == 'high'}
    response = request_api(json={'model': image_model, 'input': {'messages': [{'role': 'user',
        'content': [{'image': 'data:image/png;base64,' + base64.b64encode(data).decode()}, {'text': prompt}]}]},
        'parameters': parameters})
    jobs.check(job_id)
    jobs.update(job_id, current='排版水彩海报')
    try:
        contents = response['output']['choices'][0]['message']['content']
        raw = generated_image(next(item['image'] for item in contents if item.get('image')))
        with Image.open(BytesIO(raw)) as decoded:
            if decoded.size != size:
                raise ValueError('AI output dimensions differ from the requested size; no crop or stretch was applied')
            decoded.load()
            scene = decoded.convert('RGB').crop(bounds)
    except (KeyError, IndexError, TypeError, OSError, StopIteration):
        raise ValueError('AI did not return a usable image') from None
    image = poster(scene, original_size, payload.layout)
    jobs.check(job_id)
    art_id = uid()
    folder = folder_for(art_id)
    folder.mkdir(parents=True)
    saved = False
    try:
        scene.save(folder / 'scene.png', 'PNG')
        save_poster(folder, image, 1)
        jobs.check(job_id)
        with lock, Session() as session:
            art = Artwork(id=art_id, photo_id=photo.id if session.get(Photo, photo.id) else None,
                source_json={key: getattr(photo, key) for key in ('file_name', 'date_taken', 'camera_make',
                             'camera_model', 'lens_model', 'focal_length', 'f_number', 'exposure_time', 'iso')}
                             | {'width': original_size[0], 'height': original_size[1]}, settings_json=payload.layout.model_dump(),
                generation_json={'provider': 'Qwen', 'model': image_model, 'prompt_version': PROMPT_VERSION, 'prompt': prompt,
                                 'quality': payload.quality, 'seconds': round(monotonic() - started, 1),
                                 'parameters': parameters,
                                 'usage': response.get('usage')}, width=image.width, height=image.height)
            session.add(art)
            session.commit()
            saved = True
        result = {'photo_id': photo.id, 'artwork_id': art_id, 'url': f'/api/art/works/{art_id}/poster',
                  'file_name': photo.file_name + '_watercolor.png'}
        if not batch:
            jobs.update(job_id, processed=1, success=1, artwork_id=art_id, results=[result])
        return result
    finally:
        if not saved:
            for name in ('scene.png', 'poster-1.png', 'preview-1.webp'):
                (folder / name).unlink(missing_ok=True)
            folder.rmdir()


def suggest_titles(job_id: str, payload: ArtTitleRequest, model: str, *, batch=False) -> list[dict]:
    photo = source_photo(payload.photo_id)
    image = open_image(Path(photo.file_path))
    image.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
    clean = Image.new('RGB', image.size)
    clean.paste(image)
    buffer = BytesIO()
    clean.save(buffer, 'JPEG', quality=85)
    context = json.dumps({'user_keywords': payload.keywords, 'date_taken': photo.date_taken, 'language': payload.language}, ensure_ascii=False)
    jobs.check(job_id)
    jobs.update(job_id, current='建议海报标题', **({} if batch else {'total': 1}))
    instructions = title_instructions(payload.language)
    response = request_api(json={'model': model, 'input': {'messages': [{'role': 'user', 'content': [
        {'image': 'data:image/jpeg;base64,' + base64.b64encode(buffer.getvalue()).decode()},
        {'text': instructions + '\nContext: ' + context}]}]}, 'parameters': {'max_tokens': 700}})
    jobs.check(job_id)
    try:
        text = ''.join(item['text'] for item in response['output']['choices'][0]['message']['content'] if 'text' in item)
        text = re.sub(r'^```(?:json)?\s*|\s*```$', '', text.strip())
        suggestions = TitleSuggestions.model_validate_json(text)
        for item in suggestions.suggestions:
            ArtLayout(title=item.title)
    except (KeyError, IndexError, TypeError, ValueError):
        raise ValueError('Title suggestions could not be read; enter a title manually or try again') from None
    result = suggestions.model_dump()['suggestions']
    if not batch:
        jobs.update(job_id, processed=1, success=1, photo_id=photo.id, suggestions=result)
    return result


def generate_batch(job_id: str, payload: ArtBatchGenerate, image_model: str, title_model: str) -> None:
    results = []
    success = 0
    jobs.update(job_id, total=len(payload.photo_ids), stage='images', title_processed=0, title_total=0)
    # A batch confirms initially untitled posters; optional titles are applied only after all images finish.
    layout = payload.layout.model_copy(update={'title': '', 'title_source': 'none', 'title_evidence': ''})
    for photo_id in payload.photo_ids:
        jobs.check(job_id)
        item = {'photo_id': photo_id, 'file_name': photo_id}
        try:
            item['file_name'] = source_photo(photo_id).file_name
            result = generate(job_id, ArtGenerate(photo_id=photo_id, layout=layout, title_confirmed=True,
                              quality=payload.quality, description=payload.description), image_model, batch=True)
            item.update(result, title_status='pending' if payload.generate_titles else 'skipped')
            success += 1
        except jobs.JobCancelled:
            raise
        except Exception as error:
            item['error'] = str(error)
        results.append(item)
        jobs.update(job_id, processed=len(results), success=success, failed=len(results) - success, results=results)
    if not payload.generate_titles:
        return
    generated = [item for item in results if 'artwork_id' in item]
    jobs.update(job_id, stage='titles', title_total=len(generated))
    for index, item in enumerate(generated, 1):
        jobs.check(job_id)
        try:
            suggestions = suggest_titles(job_id, ArtTitleRequest(photo_id=item['photo_id'], keywords=payload.keywords,
                                        language=payload.language), title_model, batch=True)
            jobs.check(job_id)
            suggestion = suggestions[0]
            with lock, Session() as session:
                work = session.get(Artwork, item['artwork_id'])
                if not work:
                    raise ValueError('Artwork not found')
                titled = ArtLayout(**(work.settings_json | {'title': suggestion['title'],
                                  'title_source': 'suggested', 'title_evidence': suggestion['evidence']}))
                update_layout(session, work, titled)
            item.update(title_status='completed', title=suggestion['title'])
        except jobs.JobCancelled:
            raise
        except Exception as error:
            item.update(title_status='failed', title_error=str(error))
        jobs.update(job_id, title_processed=index, results=results)


def export(art: Artwork, extension: str) -> dict:
    source = folder_for(art.id) / f'poster-{art.revision}.png'
    stem = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', Path(art.source_json['file_name']).stem).strip('. ')[:120] or 'photo'
    # Prefix also avoids reserved Windows device names, even for an unusually named source.
    name = 'watercolor_' + stem
    EXPORTS.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as image:
        for counter in range(100000):
            target = EXPORTS / f'{name}{"_" + str(counter) if counter else ""}.{extension}'
            try:
                stream = target.open('xb')
            except FileExistsError:
                continue
            try:
                with stream:
                    image.save(stream, 'JPEG' if extension == 'jpg' else 'PNG', quality=95)
                url = export_registry.register(target)
            except Exception:
                target.unlink(missing_ok=True)
                raise
            return dict(file_name=target.name, path=str(target), url=url, width=image.width, height=image.height)
    raise ValueError('Too many conflicting export names')
