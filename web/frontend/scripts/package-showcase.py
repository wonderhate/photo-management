"""Package the public allowlist, never local author code or credentials."""
import hashlib
import json
import re
import subprocess
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def bundled_map_paths():
    """Read the trusted source manifest, never a build's editable metadata."""
    public = ROOT / 'frontend/public'
    metadata = json.loads((public / 'maps/earth/metadata.json').read_text(encoding='utf-8'))
    paths = {'maps/land-110m.json', 'maps/satellite.html', 'maps/satellite.js',
             'maps/satellite.css', 'maps/earth/metadata.json',
             'maps/earth/SHA256SUMS.txt', 'licenses/nasa-blue-marble.json',
             'licenses/leaflet-BSD-2-Clause.txt', 'licenses/leaflet-source.json'}
    for name in metadata['files']:
        if not re.fullmatch(r'(?:globe\.jpg|\d+/\d+-\d+\.jpg)', name):
            raise ValueError('Invalid bundled map path: ' + name)
        paths.add('maps/earth/' + name)
    return paths


def bundled_demo_paths():
    """Allow only the registered procedural sample and its provenance record."""
    public = ROOT / 'frontend/public'
    metadata = json.loads((public / 'demo/source.json').read_text(encoding='utf-8'))
    names = {entry['name'] for entry in metadata['files']}
    expected = {'lumina-original.png', 'lumina-adjusted.png', 'lumina-framed.png'}
    if names != expected or len(metadata['files']) != len(expected):
        raise ValueError('Invalid bundled demo manifest.')
    return {'demo/source.json'} | {'demo/' + name for name in names}


def owner_demo_paths(source):
    """Only the explicitly selected, hash-pinned, metadata-free public sample."""
    path = source / 'demo/sample.json'
    if not path.exists():
        return set()
    if path.is_symlink() or path.stat().st_size > 2048:
        raise ValueError('Invalid published demo photo.')
    record = json.loads(path.read_text(encoding='utf-8'))
    digest = record.get('sha256')
    if (set(record) != {'version', 'src', 'width', 'height', 'sha256'}
            or record.get('version') != 1 or not isinstance(digest, str)
            or not re.fullmatch('[a-f0-9]{64}', digest)
            or record.get('src') != '/demo/images/' + digest + '.jpg'
            or any(type(record.get(key)) is not int or not 1 <= record[key] <= 8192
                   for key in ('width', 'height'))):
        raise ValueError('Invalid published demo photo.')
    relative = record['src'].lstrip('/')
    image = source / relative
    if (not image.is_file() or image.is_symlink()
            or not image.resolve().is_relative_to(source.resolve())
            or image.stat().st_size > 25 * 1024 * 1024):
        raise ValueError('Invalid published demo photo.')
    data = image.read_bytes()
    if hashlib.sha256(data).hexdigest() != digest or data[:2] != b'\xff\xd8':
        raise ValueError('Published demo photo failed verification.')
    pos, width, height, scanned, ended = 2, 0, 0, False, False
    while pos < len(data):
        if data[pos] != 255:
            raise ValueError('Invalid published demo JPEG.')
        pos += 1
        while pos < len(data) and data[pos] == 255:
            pos += 1
        if pos >= len(data):
            raise ValueError('Invalid published demo JPEG.')
        marker = data[pos]
        pos += 1
        if marker == 217:
            ended = True
            break
        if marker in (0, 1, 216) or 208 <= marker <= 215 or pos + 2 > len(data):
            raise ValueError('Invalid published demo JPEG.')
        if 225 <= marker <= 239 or marker == 254:
            raise ValueError('Published demo JPEG contains private metadata.')
        length = int.from_bytes(data[pos:pos + 2], 'big')
        if length < 2 or pos + length > len(data):
            raise ValueError('Invalid published demo JPEG.')
        if marker in (192, 193, 194):
            if length < 8:
                raise ValueError('Invalid published demo JPEG.')
            height = int.from_bytes(data[pos + 3:pos + 5], 'big')
            width = int.from_bytes(data[pos + 5:pos + 7], 'big')
        pos += length
        if marker == 218:
            scanned = True
            while pos < len(data):
                if data[pos] != 255:
                    pos += 1
                    continue
                follow = pos + 1
                while follow < len(data) and data[follow] == 255:
                    follow += 1
                if follow < len(data) and (data[follow] == 0 or 208 <= data[follow] <= 215):
                    pos = follow + 1
                    continue
                break
    if not ended or not scanned or pos != len(data) or (width, height) != (record['width'], record['height']):
        raise ValueError('Invalid published demo JPEG dimensions or data.')
    return {'demo/sample.json', relative}


def validate_public(source):
    """Check a public build without producing an archive or touching owner state."""
    source = Path(source)
    files = sorted(p for p in source.rglob('*') if p.is_file())
    if not (source / 'index.html').is_file():
        raise ValueError('Build the public showcase first.')
    allowed_root = {'index.html', 'windows.html', 'sw.js', 'site-notes.js', 'site-glass.css', 'site-glass.js', 'local-file-worker.js', 'pageview.js', 'robots.txt', 'sitemap.xml', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'edgeone.json'}
    map_paths = bundled_map_paths()
    demo_paths = bundled_demo_paths()
    selected_demo_paths = owner_demo_paths(source)
    public_paths = {'about/index.html', 'lumina/index.html', 'en/index.html', 'en/about/index.html', 'en/lumina/index.html'} | map_paths | demo_paths | selected_demo_paths
    allowed_dirs = {'assets', 'local-assets', 'raw-1.6.0', 'licenses', 'portfolio'}
    for p in files:
        rel = p.relative_to(source)
        if p.is_symlink() or source.resolve() not in p.resolve().parents:
            raise ValueError('Unexpected symlink in public output.')
        if (len(rel.parts) == 1 and rel.name not in allowed_root) or (len(rel.parts) > 1 and rel.parts[0] not in allowed_dirs and rel.as_posix() not in public_paths):
            raise ValueError('Unexpected public artifact: ' + rel.as_posix())
        name = p.name.lower()
        if p.suffix.lower() in {'.map', '.py', '.env', '.dpapi', '.db', '.sqlite', '.sqlite3', '.log', '.key', '.pem', '.pfx', '.p12', '.onnx', '.safetensors', '.bin', '.pt', '.pth', '.ckpt', '.gguf'} or name.startswith('.env') or 'publishportfolio-' in name or 'local-publisher' in name:
            raise ValueError('Private author code cannot be published.')
        if p.stat().st_size > 25 * 1024 * 1024:
            raise ValueError('Public file exceeds 25 MiB: ' + rel.as_posix())
        if rel.as_posix() in map_paths | demo_paths:
            original = ROOT / 'frontend/public' / rel
            if (not original.is_file() or original.is_symlink()
                    or not original.resolve().is_relative_to((ROOT / 'frontend/public').resolve())
                    or original.read_bytes() != p.read_bytes()):
                kind = 'Map' if rel.as_posix() in map_paths else 'Demo'
                raise ValueError(kind + ' asset does not match its bundled source: ' + rel.as_posix())
    index = (source / 'index.html').read_text(encoding='utf-8')
    if 'windows.html' not in {p.name for p in files} or "unsafe-inline'" in index:
        raise ValueError('Missing download page or unexpected inline script policy.')
    catalog = json.loads((source / 'portfolio/manifest.json').read_text(encoding='utf-8'))
    referenced = {url.removeprefix('/') for p in catalog['photos'] for url in (p['src'], p['thumbnail'])}
    actual = {p.relative_to(source).as_posix() for p in files if p.relative_to(source).parts[:2] == ('portfolio', 'images')}
    if referenced != actual:
        raise ValueError('Unselected images in the public build.')
    if not any(b'wss://ai.photomanagement.online/cloud-art' in p.read_bytes() for p in files if p.suffix in {'.js', '.mjs'}):
        raise ValueError('Build must use the formal WSS relay URL.')
    actual_paths = {p.relative_to(source).as_posix() for p in files}
    if not map_paths.issubset(actual_paths):
        raise ValueError('Incomplete offline map assets: ' + ', '.join(sorted(map_paths - actual_paths)))
    if not demo_paths.issubset(actual_paths):
        raise ValueError('Incomplete bundled demo assets: ' + ', '.join(sorted(demo_paths - actual_paths)))
    return files, catalog


def package():
    source = ROOT / 'frontend' / 'dist-showcase'
    files, catalog = validate_public(source)
    release = ROOT / 'releases' / ('Lumina-Web-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    release.mkdir(parents=True)
    archive = release / 'browser-static.zip'
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
        for p in files:
            z.write(p, p.relative_to(source).as_posix())
    with zipfile.ZipFile(archive) as z:
        if z.testzip() is not None:
            raise ValueError('ZIP integrity check failed.')
    manifest = {'project_id': 'makers-o7xx3x5jqy77', 'site': 'https://photomanagement.online/',
                'version': json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version'],
                'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                'working_tree_dirty': bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True).strip()),
                'photos': len(catalog['photos']), 'files': {p.relative_to(source).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in files},
                'zip_sha256': hashlib.sha256(archive.read_bytes()).hexdigest()}
    (release / 'release-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    return archive


if __name__ == '__main__':
    print(package())
