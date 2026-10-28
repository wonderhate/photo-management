"""Optional, bounded read-only ExifTool batches. Never install or download tools."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
from tempfile import TemporaryDirectory
from time import monotonic, sleep
from ..config import DATA
from . import jobs

BATCH_SIZE=24
TIMEOUT=15
MAX_OUTPUT=2*1024*1024
TAGS=('ImageWidth','ImageHeight','ExifImageWidth','ExifImageHeight','Orientation','Make','Model',
    'LensModel','LensID','FNumber','ExposureTime','ISO','FocalLength','FocalLengthIn35mmFormat',
    'DateTimeOriginal','CreateDate','OffsetTimeOriginal','GPSLatitude','GPSLongitude','GPSLatitudeRef',
    'GPSLongitudeRef','GPSAltitude','GPSAltitudeRef','ProfileDescription','ColorSpace',
    'Rating','Label','Subject','HierarchicalSubject','Title','Description','Creator','Copyright')


def command():
    configured=os.environ.get('PHOTO_EXIFTOOL')
    located=configured or shutil.which('exiftool')
    if not located:return None
    path=Path(located).expanduser().resolve()
    if not path.is_file():return None
    if os.name!='nt' or path.suffix.lower()=='.exe':return [str(path)]
    perl=os.environ.get('PHOTO_EXIFTOOL_PERL') or shutil.which('perl')
    return [str(Path(perl).resolve()),str(path)] if perl and Path(perl).is_file() else None


def check(job_id):
    if job_id:jobs.check(job_id)


def fingerprint(path,job_id):
    digest=hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):
            check(job_id);digest.update(chunk)
    return digest.hexdigest()


def stop(process):
    if process.poll() is not None:return
    if os.name=='nt':
        # The Windows distribution can launch its bundled Perl as a child.
        try:subprocess.run(['taskkill','/PID',str(process.pid),'/T','/F'],stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,timeout=3,creationflags=subprocess.CREATE_NO_WINDOW)
        except (OSError,subprocess.SubprocessError):pass
    if process.poll() is None:process.kill()
    process.wait(timeout=3)


def read_batch(paths,job_id=None):
    executable=command()
    if not executable:return {}
    paths=list(dict.fromkeys(Path(p).resolve() for p in paths))
    if len(paths)>BATCH_SIZE:raise ValueError('Metadata batch exceeds its limit')
    paths=[p for p in paths if '\n' not in str(p) and '\r' not in str(p)]
    if not paths:return {}
    process=None
    try:
        snapshots={}
        for path in paths:
            check(job_id)
            try:snapshots[path]=(path.stat(),fingerprint(path,job_id))
            except OSError:continue
        if not snapshots:return {}
        work=(DATA/'previews'/'.metadata-read').resolve()
        if not work.is_relative_to(DATA.resolve()):return {}
        work.mkdir(parents=True,exist_ok=True)
        with TemporaryDirectory(prefix='read-',dir=work) as folder:
            folder=Path(folder);arguments=folder/'arguments.txt';output=folder/'result.json'
            arguments.write_text('\n'.join(str(p) for p in snapshots)+'\n','utf-8')
            with output.open('wb') as stream:
                # Empty -config disables executable user configuration; no write flags.
                args=[*executable,'-config','','-json','-G1','-n','-a','-s','-fast','-charset','filename=utf8',
                    '-api','LargeFileSupport=1',*('-'+tag for tag in TAGS),'-@',str(arguments)]
                process=subprocess.Popen(args,stdin=subprocess.DEVNULL,stdout=stream,stderr=subprocess.DEVNULL,
                    env={**os.environ,'TZ':'UTC'},**({'creationflags':subprocess.CREATE_NO_WINDOW} if os.name=='nt' else {}))
                started=monotonic()
                try:
                    while process.poll() is None:
                        check(job_id)
                        if monotonic()-started>TIMEOUT or output.stat().st_size>MAX_OUTPUT:raise ValueError('Metadata reader limit')
                        sleep(.03)
                    check(job_id)
                finally:stop(process)
            if output.stat().st_size>MAX_OUTPUT or process.returncode not in (0,1):return {}
            records=json.loads(output.read_text('utf-8'))
            if not isinstance(records,list):return {}
            result={}
            for record in records:
                if not isinstance(record,dict) or not isinstance(record.get('SourceFile'),str):continue
                path=Path(record['SourceFile']).resolve()
                if path not in snapshots or any(key.split(':')[-1]=='Error' for key in record):continue
                before,digest=snapshots[path]
                try:
                    after=path.stat()
                    if (before.st_size,before.st_mtime_ns)!=(after.st_size,after.st_mtime_ns):continue
                    if fingerprint(path,job_id)!=digest or path.stat().st_mtime_ns!=before.st_mtime_ns:continue
                except OSError:continue
                tags={k:v for k,v in record.items() if k!='SourceFile' and k.split(':')[-1] in TAGS}
                if tags:result[path]={'sha256':digest,'tags':tags}
            return result
    except jobs.JobCancelled:raise
    except (OSError,ValueError,subprocess.SubprocessError,UnicodeError):return {}
