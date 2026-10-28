"""Cancellable native format fallback. Originals and editor snapshots stay read-only."""
import hashlib
import json
import multiprocessing
from pathlib import Path
from tempfile import TemporaryDirectory
from time import monotonic
from fastapi import HTTPException
from PIL import Image, __version__ as pillow_version
import pillow_heif
from ..config import DATA
from ..models import Photo, Session
from . import jobs, display_worker
from .image_decode import DISPLAY_DECODE_VERSION

FORMATS={'.tif','.tiff','.heic','.heif'}
ENGINE=DISPLAY_DECODE_VERSION+'-pillow-'+pillow_version+'-heif-'+pillow_heif.__version__
MAX_BYTES=64*1024*1024
TIMEOUT=180


def fingerprint(path,cancelled):
    digest=hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):
            if cancelled.is_set():raise jobs.JobCancelled()
            digest.update(block)
    return digest.hexdigest()


def render(photo_id,source_hash,edge,cancelled):
    with Session() as session:
        photo=session.get(Photo,photo_id)
        if not photo:raise HTTPException(404,'照片不存在')
        if photo.file_hash!=source_hash:raise HTTPException(409,'原片内容已变化，请重新定位或重新导入')
        source=Path(photo.file_path)
        if source.suffix.lower() not in FORMATS:raise HTTPException(422,'此格式不使用原生高清预览回退')
    if not source.is_file():raise HTTPException(404,'原始照片不可用，请重新定位')
    with jobs.display_render_slot(cancelled):
        before=source.stat()
        if before.st_size>256*1024*1024:raise HTTPException(413,'照片超过 256 MiB 高清处理上限')
        if fingerprint(source,cancelled)!=source_hash:raise HTTPException(409,'原片内容已变化，请重新定位或重新导入')
        work=(DATA/'previews'/'.display-work').resolve()
        if not work.is_relative_to(DATA.resolve()):raise HTTPException(409,'高清预览工作目录无效')
        work.mkdir(parents=True,exist_ok=True)
        with TemporaryDirectory(prefix='decode-',dir=work) as folder:
            target=Path(folder)/'display.jpg'
            process=multiprocessing.get_context('spawn').Process(target=display_worker.render,args=(str(source),str(target),edge),daemon=True)
            try:
                process.start();started=monotonic()
                while process.is_alive():
                    if cancelled.is_set():raise jobs.JobCancelled()
                    if monotonic()-started>TIMEOUT:raise HTTPException(504,'高清预览处理超时，请使用标准预览')
                    process.join(.03)
                if cancelled.is_set():raise jobs.JobCancelled()
                if process.exitcode!=0 or not target.is_file() or target.stat().st_size>MAX_BYTES:raise HTTPException(422,'原生高清预览解码失败，请使用标准预览')
                info=json.loads(target.with_suffix('.json').read_text('utf-8'))
                if info.get('error'):raise HTTPException(422,'原生高清预览解码失败，请使用标准预览')
                with Image.open(target) as image:
                    if image.format!='JPEG' or max(image.size)>edge or image.width*image.height>100_000_000:raise HTTPException(422,'高清预览尺寸无效')
                    image.verify()
                after=source.stat()
                if (before.st_size,before.st_mtime_ns)!=(after.st_size,after.st_mtime_ns) or fingerprint(source,cancelled)!=source_hash or source.stat().st_mtime_ns!=before.st_mtime_ns:raise HTTPException(409,'生成预览时原片已变化，请重新导入')
                return target.read_bytes()
            finally:
                if process.pid is not None:
                    if process.is_alive():process.terminate()
                    process.join();process.close()
