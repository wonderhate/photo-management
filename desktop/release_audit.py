"""Fail closed on private runtime data in a distributable Windows directory."""
import argparse
import hashlib
import json
from pathlib import Path

FORBIDDEN_SUFFIXES = {'.db', '.sqlite', '.sqlite3', '.dpapi', '.log', '.safetensors', '.onnx', '.pt', '.pth'}
FORBIDDEN_PARTS = {'.local-notes', '.test-artifacts', '__screenshots__', 'node_modules', '.git'}
FORBIDDEN_NAMES = {'library-config.json', 'settings.json', 'desktop.log', 'pytorch_model.bin', 'model.bin'}
REQUIRED = (
    'PhotoCollection.exe', 'LICENSE',
    '_internal/backend/app/vision_models.json',
    '_internal/frontend/dist/index.html',
    '_internal/frontend/dist/licenses/vision/transformers-Apache-2.0.txt',
    '_internal/frontend/dist/licenses/vision/onnxruntime-LICENSE.txt',
    '_internal/frontend/dist/licenses/vision/onnxruntime-ThirdPartyNotices.txt',
    '_internal/frontend/dist/licenses/vision/sources.json',
    '_internal/backend/app/assets/brand_logos/sources.json',
    '_internal/backend/app/assets/frame-templates-source.json',
    *(f'_internal/backend/app/assets/signatures/{name}-OFL.txt' for name in
      ('alexbrush','kaushanscript','liujianmaocao','longcang','mashanzheng','sacramento','zhimangxing')),
)


def audit(package: Path, *, required=True) -> dict:
    package=package.resolve(strict=True)
    files=[]
    for path in sorted(package.rglob('*')):
        relative=path.relative_to(package)
        if path.is_symlink() or getattr(path,'is_junction',lambda:False)():
            raise ValueError(f'Release contains a filesystem link: {relative}')
        if not path.is_file():continue
        parts={part.lower() for part in relative.parts}
        name=path.name.lower()
        if parts & FORBIDDEN_PARTS or path.suffix.lower() in FORBIDDEN_SUFFIXES or name in FORBIDDEN_NAMES or name.startswith('.env') or name.endswith(('-wal','-shm')):
            raise ValueError(f'Release contains private data or an unapproved model: {relative}')
        if name=='release-manifest.json':continue
        sha=hashlib.sha256()
        with path.open('rb') as stream:
            for chunk in iter(lambda:stream.read(1024*1024),b''):sha.update(chunk)
        files.append({'path':relative.as_posix(),'bytes':path.stat().st_size,'sha256':sha.hexdigest()})
    if required:
        missing=[name for name in REQUIRED if not (package/name).is_file()]
        if missing:raise ValueError('Missing release resources: '+', '.join(missing))
    return {'schema':1,'files':files}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('package',type=Path)
    parser.add_argument('--write-manifest',action='store_true')
    args=parser.parse_args()
    result=audit(args.package)
    manifest=args.package/'release-manifest.json'
    if args.write_manifest:manifest.write_text(json.dumps(result,indent=2)+'\n','utf-8')
    elif not manifest.is_file() or json.loads(manifest.read_text('utf-8'))!=result:
        raise ValueError('Release file hashes do not match the build manifest')
    print(f'Release privacy, resources and hashes: {len(result["files"])} files PASS')


if __name__=='__main__':main()
