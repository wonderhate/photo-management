"""Identify the backend and served frontend build without importing application config."""
from hashlib import sha256
from pathlib import Path

VERSION='2.1.0'

def build_id() -> str:
    root=Path(__file__).resolve().parents[1]
    digest=sha256()
    for path in sorted((root/'backend'/'app').rglob('*.py')):
        digest.update(str(path.relative_to(root)).encode());digest.update(path.read_bytes())
    index=root/'frontend'/'dist'/'index.html'
    if index.is_file():digest.update(index.read_bytes())
    return digest.hexdigest()[:16]

if __name__=='__main__':print(build_id())
