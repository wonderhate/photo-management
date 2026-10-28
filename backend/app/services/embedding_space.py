"""Content-addressed local semantic model and source identity.

No network requests or model execution occur while inspecting this manifest.
Legacy vectors without this identity remain rebuildable, not trusted matches.
"""
import hashlib
import json
from importlib.metadata import version, PackageNotFoundError
from pathlib import Path

PIPELINE = 'pc-chinese-clip-preview-v3'


def file_hash(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def source_signature(path):
    info = Path(path).stat()
    return f'{info.st_size}:{info.st_mtime_ns}:{info.st_ctime_ns}'


def model_manifest(location, model_name):
    folder = Path(location)
    files = []
    for path in sorted(folder.rglob('*')):
        if path.is_file() and (path.suffix in ('.json', '.safetensors', '.bin') or path.name=='vocab.txt'):
            files.append({'path':path.relative_to(folder).as_posix(),'sha256':file_hash(path)})
    if not files or not any(f['path'].endswith(('.safetensors','.bin')) for f in files):
        raise ValueError('本地语义模型文件不完整，请重新准备模型')
    runtime = {}
    for name in ('torch','transformers','Pillow'):
        try:runtime[name] = version(name)
        except PackageNotFoundError:runtime[name] = 'unavailable'
    manifest = dict(version=1,pipeline=PIPELINE,model=model_name,files=files,runtime=runtime)
    revision = hashlib.sha256(json.dumps(manifest,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    return revision, manifest
