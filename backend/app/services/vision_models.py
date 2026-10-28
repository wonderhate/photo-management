"""Import allowlisted offline models; no downloads, credentials or remote code."""
import hashlib
import importlib.util
import json
import os
import shutil
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import RLock
from fastapi import HTTPException
from ..config import MODELS

CATALOG=json.loads((Path(__file__).parent.parent/'vision_models.json').read_text('utf-8'))
LOCK=RLock()

def spec(id):
    item=next((s for s in CATALOG if s['id']==id and s['runtime']=='native'),None)
    if item is None:raise HTTPException(422,'Unknown local vision model.')
    return item

def folder(item):
    path=MODELS/'vision'/item['id']/item['revision']
    for part in [path,*path.parents]:
        if part==MODELS:break
        if part.is_symlink() or getattr(part,'is_junction',lambda:False)():raise HTTPException(409,'Invalid local model directory.')
    if not path.resolve().is_relative_to(MODELS.resolve()):raise HTTPException(409,'Invalid local model directory.')
    return path

def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        while part:=f.read(1024*1024):h.update(part)
    return h.hexdigest()

def installed(item,verify=False):
    target=folder(item)
    for expected in item['files']:
        path=target/expected['name']
        if path.is_symlink() or not path.is_file() or path.stat().st_size!=expected['bytes']:return False
        if verify and digest(path)!=expected['sha256']:return False
    return True

def status():
    available=all(importlib.util.find_spec(name) is not None for name in ('torch','transformers','safetensors'))
    return [dict(item,installed=installed(item),dependency=available,engine='transformers-cpu',network='never') for item in CATALOG if item['runtime']=='native']

def import_files(id,files,confirmed):
    if confirmed is not True:raise HTTPException(422,'Confirm the local model license before importing.')
    item=spec(id)
    if len(files)!=len(item['files']):raise HTTPException(422,'Choose every file in the pinned model manifest.')
    provided={f.filename:f for f in files}
    if len(provided)!=len(files) or set(provided)!={f['name'] for f in item['files']}:raise HTTPException(422,'Choose every file in the pinned model manifest.')
    with LOCK:
        target=folder(item);target.parent.mkdir(parents=True,exist_ok=True)
        if installed(item,verify=True):return dict(id=id,installed=True)
        if target.exists():raise HTTPException(409,'Model files are incomplete or changed. Keep a backup and remove this model version before importing again.')
        with TemporaryDirectory(prefix='.import-',dir=target.parent) as temp:
            stage=Path(temp)/'model';stage.mkdir()
            for expected in item['files']:
                file=provided[expected['name']];dest=stage/expected['name'];dest.parent.mkdir(parents=True,exist_ok=True);h=hashlib.sha256();size=0
                with dest.open('xb') as output:
                    while part:=file.file.read(1024*1024):
                        size+=len(part)
                        if size>expected['bytes']:raise HTTPException(422,'Model file does not match its pinned checksum.')
                        h.update(part);output.write(part)
                    output.flush();os.fsync(output.fileno())
                if size!=expected['bytes'] or h.hexdigest()!=expected['sha256']:raise HTTPException(422,'Model file does not match its pinned checksum.')
            # Existing versions are never replaced. The import is published once.
            os.rename(stage,target)
        return dict(id=id,installed=True)
