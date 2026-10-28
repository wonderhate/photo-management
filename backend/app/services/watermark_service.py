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
    if options.get('frame_v2') is not None and options['template']=='frame':
        from ..watermark import frame_v2_renderer
        with frame_v2_renderer.source_image(photo.file_path) as image:
            return frame_v2_renderer.render(image,options['frame_v2'],1200 if preview else options['long_edge'])
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
    return export_source(photo, options, index, output_directory)


def export_source(photo, options: dict, index: int = 1, output_directory: str | None = None, job_id=None) -> dict:
    from .safe_image_export import publish_image, digest
    options=WatermarkOptions.model_validate(options).model_dump()
    check=(lambda:jobs.check(job_id)) if job_id else (lambda:None)
    source=Path(photo.file_path)
    if not source.is_file():raise ValueError('原图已移动或删除；请重新导入新位置以关联文件')
    before=digest(source,check)
    expected=getattr(photo,'file_hash',None)
    if expected and before!=expected:raise ValueError('The source photo changed. Reopen it before saving.')
    values=dict(original=Path(photo.file_name).stem,date=(photo.date_taken or photo.created_at)[:10],camera=photo.camera_model or 'camera',index=str(index).zfill(3))
    name=options['filename_template']
    for key,value in values.items():name=name.replace('{'+key+'}',value)
    with render(photo,options) as image:
        check()
        if digest(source,check)!=before:raise ValueError('The source photo changed. Reopen it before saving.')
        result=publish_image(image,Path(output_directory) if output_directory else EXPORTS,name,options['format'],options['quality'],check)
    return {**result,'source_sha256':before}


def batch_export(job_id: str, ids: list[str], options: dict) -> None:
    from .frame_batch import snapshot,options_for
    context=snapshot()
    results, errors = [], []
    jobs.update(job_id, total=len(ids))
    for index, photo_id in enumerate(ids, 1):
        jobs.check(job_id)
        jobs.update(job_id, current=photo_id)
        try:
            with Session() as session:
                photo=session.get(Photo,photo_id)
                if not photo:raise ValueError('照片记录不存在')
                current_options=options_for(photo,options,context)
            results.append(export_source(photo,current_options,index,job_id=job_id))
        except jobs.JobCancelled:raise
        except Exception as error:
            errors.append(str(error))
        jobs.update(job_id, processed=index, success=len(results), failed=len(errors), errors=errors, results=results)
