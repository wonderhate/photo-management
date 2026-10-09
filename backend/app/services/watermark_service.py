from pathlib import Path
from io import BytesIO
import re
from PIL import Image
from ..models import Session, Photo
from ..config import EXPORTS
from ..schemas import WatermarkOptions
from ..watermark import frame_renderer, ambient_renderer
from .thumbnail_service import open_image
from . import jobs
from .export_registry import register

def render(photo: Photo, options: dict, preview: bool = False) -> Image.Image:
    options = WatermarkOptions.model_validate(options).model_dump()
    source = Path(photo.preview_path) if preview and photo.preview_path else Path(photo.file_path)
    if not source.is_file():
        raise ValueError('原图已移动或删除；请重新导入新位置以关联文件')
    try:
        image = open_image(source)
    except Exception as error:
        raise ValueError(f'无法读取照片用于水印：{error}') from error
    limit = 1200 if preview else options['long_edge']
    if limit:
        image.thumbnail((limit, limit), Image.Resampling.LANCZOS)
    values = {key: getattr(photo, key) for key in ['file_name', 'camera_make', 'camera_model', 'lens_model', 'focal_length', 'f_number', 'exposure_time', 'iso', 'date_taken']}
    renderer = ambient_renderer if options['template'] == 'ambient' else frame_renderer
    result = renderer.render(image, values, options)
    if limit:
        result.thumbnail((limit, limit), Image.Resampling.LANCZOS)
    return result

def export_one(photo_id: str, options: dict, index: int = 1, output_directory: str | None = None) -> dict:
    with Session() as session:
        photo = session.get(Photo, photo_id)
        if not photo:
            raise ValueError('照片记录不存在')
    image = render(photo, options)
    extension = options['format']
    values = dict(original=Path(photo.file_name).stem, date=(photo.date_taken or photo.created_at)[:10],
                  camera=photo.camera_model or 'camera', index=str(index).zfill(3))
    name = options['filename_template']
    for key, value in values.items():
        name = name.replace('{' + key + '}', value)
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', name).strip('. ')[:160] or 'photo_watermark'
    name = re.sub(r'\.(jpg|jpeg|png)$', '', name, flags=re.I)
    if name.split('.')[0].upper() in {'CON','PRN','AUX','NUL',*[f'COM{i}' for i in range(1,10)],*[f'LPT{i}' for i in range(1,10)]}:
        name = '_' + name
    folder = Path(output_directory) if output_directory else EXPORTS
    if not folder.is_absolute():
        raise ValueError('输出目录必须是绝对路径')
    folder = folder.resolve()
    folder.mkdir(parents=True, exist_ok=True)
    for counter in range(100000):
        target = folder / f'{name}{"_"+str(counter) if counter else ""}.{extension}'
        try:
            with target.open('xb') as stream:
                image.save(stream, 'JPEG' if extension == 'jpg' else 'PNG', quality=options['quality'])
            return dict(file_name=target.name, path=str(target), url=register(target), width=image.width, height=image.height)
        except FileExistsError:
            continue
    raise ValueError('导出文件名冲突过多')

def batch_export(job_id: str, ids: list[str], options: dict) -> None:
    results, errors = [], []
    jobs.update(job_id, total=len(ids))
    for index, photo_id in enumerate(ids, 1):
        jobs.check(job_id)
        jobs.update(job_id, current=photo_id)
        try:
            results.append(export_one(photo_id, options, index))
        except Exception as error:
            errors.append(str(error))
        jobs.update(job_id, processed=index, success=len(results), failed=len(errors), errors=errors, results=results)
