import hashlib
import io
import json
import multiprocessing
from pathlib import Path
from tempfile import TemporaryDirectory
from time import monotonic
from PIL import Image
from fastapi import HTTPException
from sqlalchemy import select
from ..config import DATA
from ..models import Session,Photo,VisionAsset
from ..vision_schemas import MAX_BYTES,MAX_PIXELS
from . import jobs,vision_models,vision_worker,vision_assets
from .import_service import file_hash

def check_source(payload):
    if not payload.photo_id:return
    with Session() as session:
        photo=session.get(Photo,payload.photo_id)
        if not photo or photo.file_hash!=payload.source.sha256 or not Path(photo.file_path).is_file() or file_hash(Path(photo.file_path))!=payload.source.sha256:raise HTTPException(409,'The source photo changed. Reopen it before saving.')

def submit(payload,data):
    spec=vision_models.spec(payload.model_id)
    if spec['kind']!=payload.kind:raise HTTPException(422,'Unknown local vision model.')
    if not vision_models.installed(spec):raise HTTPException(409,'Import the pinned local model files before running inference.')
    if not data or len(data)>MAX_BYTES:raise HTTPException(413,'Local vision input exceeds the size limit.')
    try:
        with Image.open(io.BytesIO(data)) as original:
            if getattr(original,'n_frames',1)!=1 or original.width*original.height>MAX_PIXELS:raise ValueError()
            if abs(original.width*payload.source.height-original.height*payload.source.width)>max(payload.source.width,payload.source.height):raise ValueError()
            image=original.convert('RGB');image.thumbnail((2048,2048),Image.Resampling.LANCZOS);image.info.clear();buffer=io.BytesIO();image.save(buffer,'PNG');clean=buffer.getvalue()
    except (ValueError,OSError,Image.DecompressionBombError):raise HTTPException(422,'Invalid local vision input.')
    check_source(payload)
    return jobs.submit('vision-'+payload.kind,run,payload.model_copy(deep=True),clean,resource='local-ai')

def run(job_id,payload,data):
    spec=vision_models.spec(payload.model_id);jobs.check(job_id)
    if not vision_models.installed(spec,verify=True):raise ValueError('Model file does not match its pinned checksum.')
    jobs.update(job_id,total=1 if payload.kind=='depth' else len(payload.instances),phase='local-inference',source_hash=payload.source.sha256)
    cache_id='depth-'+hashlib.sha256(data).hexdigest() if payload.kind=='depth' else None
    if cache_id:
        with Session() as session:
            for row in session.scalars(select(VisionAsset).where(VisionAsset.kind=='depth',VisionAsset.record['instance_id'].as_string()==cache_id)):
                record=row.record
                if record['source']==payload.source.model_dump() and record['model']['revision']==spec['revision']:
                    vision_assets.checked(row);jobs.check(job_id);check_source(payload)
                    jobs.update(job_id,results=[dict(asset_id=row.id,instance_id=cache_id)],processed=1,success=1);return
    work=DATA/'masks'/'.inference';work.mkdir(parents=True,exist_ok=True)
    with TemporaryDirectory(prefix='vision-',dir=work) as temp:
        folder=Path(temp);input=folder/'input.png';input.write_bytes(data)
        process=multiprocessing.get_context('spawn').Process(target=vision_worker.infer,args=(str(vision_models.folder(spec)),payload.kind,str(input),str(folder),[i.model_dump() for i in payload.instances]),daemon=True)
        try:
            process.start();start=monotonic()
            while process.is_alive():
                jobs.check(job_id)
                if monotonic()-start>300:raise ValueError('Local vision request timed out.')
                process.join(.05)
            jobs.check(job_id);check_source(payload);path=folder/'result.json'
            if process.exitcode!=0 or not path.is_file() or path.stat().st_size>8192:raise ValueError('Local vision inference failed. Check the model files and available memory.')
            report=json.loads(path.read_text('utf-8'))
            if report.get('error'):raise ValueError(report['error'])
            rows=report.get('items');expected=1 if payload.kind=='depth' else len(payload.instances)
            if not isinstance(rows,list) or len(rows)!=expected:raise ValueError('Invalid local vision output.')
            results=[]
            for i,row in enumerate(rows):
                jobs.check(job_id);check_source(payload);name='depth.png' if payload.kind=='depth' else f'subject-{i}.png';path=folder/name
                if row.get('file')!=name or not path.is_file() or path.stat().st_size>MAX_BYTES:raise ValueError('Invalid local vision output.')
                asset=vision_assets.save(path.read_bytes(),payload.name if payload.kind=='depth' else f'{payload.name} {i+1}',kind='depth' if payload.kind=='depth' else 'sticker',source=payload.source.model_dump(),model=dict(id=spec['id'],revision=spec['revision'],engine='transformers-cpu',license=spec['license']),instance_id=cache_id or row['instance_id'])
                results.append(dict(asset_id=asset['id'],instance_id=cache_id or row['instance_id']));jobs.update(job_id,results=results,processed=len(results),success=len(results))
        finally:
            if process.pid is not None:
                if process.is_alive():process.terminate()
                process.join(5)
                if process.is_alive():process.kill();process.join(5)
            process.close()
