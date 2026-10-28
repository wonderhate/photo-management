"""One cancellable import decoder inside the existing shared render lease."""
import json
import multiprocessing
from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from time import monotonic
from PIL import Image
from ..config import DATA, settings
from . import jobs, raw_preview_worker

TIMEOUT=180
MAX_OUTPUT_BYTES=64*1024*1024


@contextmanager
def prepare(source,job_id):
    jobs.check(job_id)
    if source.stat().st_size>raw_preview_worker.MAX_BYTES:raise ValueError('RAW 超过 256 MiB 预览处理上限')
    work=(DATA/'previews'/'.raw-import').resolve()
    if not work.is_relative_to(DATA.resolve()):raise ValueError('RAW 预览工作目录无效')
    work.mkdir(parents=True,exist_ok=True)
    with TemporaryDirectory(prefix='decode-',dir=work) as folder:
        folder=Path(folder)
        process=multiprocessing.get_context('spawn').Process(target=raw_preview_worker.render,
            args=(str(source),str(folder),settings()['thumbnail_quality']),daemon=True)
        try:
            process.start();started=monotonic()
            while process.is_alive():
                jobs.check(job_id)
                if monotonic()-started>TIMEOUT:raise ValueError('RAW 预览处理超时，可重新扫描补齐')
                process.join(.03)
            jobs.check(job_id)
            report=folder/'result.json'
            if process.exitcode!=0 or not report.is_file() or report.stat().st_size>4096:raise ValueError('RAW 预览解码失败')
            info=json.loads(report.read_text('utf-8'))
            if info.get('error')=='limit':raise ValueError('RAW 超过 1 亿像素或 256 MiB 预览处理上限')
            if info.get('error'):raise ValueError('RAW 格式不受支持或文件已损坏')
            width,height=info.get('width'),info.get('height')
            if type(width) is not int or type(height) is not int or min(width,height)<=0 or width*height>raw_preview_worker.MAX_PIXELS:
                raise ValueError('RAW 源尺寸无效')
            result={'width':width,'height':height}
            for key,name,edge in [('preview_path','preview',2560),('thumbnail_path','thumbnail',560)]:
                target=folder/(name+'.jpg')
                if not target.is_file() or target.stat().st_size>MAX_OUTPUT_BYTES:raise ValueError('RAW 预览解码失败')
                with Image.open(target) as image:
                    if image.format!='JPEG' or max(image.size)>edge or image.width*image.height>raw_preview_worker.MAX_PIXELS:
                        raise ValueError('RAW 预览尺寸无效')
                    image.verify()
                result[key]=str(target)
            yield result
        finally:
            if process.pid is not None:
                if process.is_alive():process.terminate()
                process.join(2)
                if process.is_alive():process.kill();process.join()
                process.close()
