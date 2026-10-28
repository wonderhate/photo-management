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


def validate_public(source):
    """Check a public build without producing an archive or touching owner state."""
    source = Path(source)
    files = sorted(p for p in source.rglob('*') if p.is_file())
    if not (source / 'index.html').is_file():
        raise ValueError('Build the public showcase first.')
    allowed_root = {'index.html', 'windows.html', 'sw.js', 'site-notes.js', 'site-glass.css', 'site-glass.js', 'local-file-worker.js', 'pageview.js', 'robots.txt', 'sitemap.xml', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'edgeone.json'}
    map_paths = bundled_map_paths()
    demo_paths = bundled_demo_paths()
    public_paths = {'about/index.html', 'lumina/index.html', 'en/index.html', 'en/about/index.html', 'en/lumina/index.html'} | map_paths | demo_paths
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
