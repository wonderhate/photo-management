"""Package the public browser build and an explicit, data-free relay source list."""
import hashlib
import json
import re
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[2]
RELAY_URL = 'wss://ai.photomanagement.online/cloud-art'
PUBLIC_FILES = {'index.html', 'sw.js', 'edgeone.json', 'manifest.webmanifest',
                'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'}
PUBLIC_DIRS = {'assets', 'licenses', 'local-assets', 'raw-1.6.0'}
RELAY_FILES = ['LICENSE', 'cloud_relay/__init__.py', 'cloud_relay/app.py',
               'cloud_relay/requirements.txt', 'cloud_relay/Dockerfile',
               'cloud_relay/Dockerfile.dockerignore', 'cloud_relay/compose.yaml',
               'cloud_relay/Caddyfile', 'backend/app/art_schemas.py',
               'backend/app/services/qwen_protocol.py']


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


def public_files(folder):
    if folder.is_symlink():
        raise ValueError('The public build directory must not be a symbolic link')
    base = folder.resolve()
    map_paths = bundled_map_paths()
    files = []
    for path in sorted(folder.rglob('*')):
        name = path.relative_to(folder)
        if path.is_symlink() or not path.resolve().is_relative_to(base):
            raise ValueError(f'Linked public asset refused: {name}')
        if not path.is_file():
            continue
        if (any(part.startswith('.') for part in name.parts)
                or (len(name.parts) == 1 and name.name not in PUBLIC_FILES)
                or (len(name.parts) > 1 and name.parts[0] not in PUBLIC_DIRS
                    and name.as_posix() not in map_paths)
                or path.suffix.lower() in {'.db', '.sqlite', '.sqlite3', '.log', '.pem', '.key'}):
            raise ValueError(f'Unexpected public asset refused: {name}')
        if name.parts[0] == 'assets' and path.suffix not in {'.js', '.css'}:
            raise ValueError(f'Non-code file in generated bundles refused: {name}')
        source = None
        if name.parts[0] == 'local-assets':
            source = ROOT / 'backend/app/assets' / Path(*name.parts[1:])
        elif name.parts[0] == 'raw-1.6.0':
            if name.name not in {'index.js', 'worker.js', 'libraw.js', 'libraw.wasm'}:
                raise ValueError(f'Unexpected RAW runtime asset refused: {name}')
            source = ROOT / 'frontend/node_modules/libraw-wasm/dist' / name.name
        elif name.parts[0] in {'licenses', 'maps'}:
            source = ROOT / 'frontend/public' / name
        if source is not None and (not source.is_file() or source.is_symlink()
                                   or (name.parts[0] == 'maps' and not source.resolve().is_relative_to((ROOT / 'frontend/public').resolve()))
                                   or source.read_bytes() != path.read_bytes()):
            raise ValueError(f'Public asset does not match its bundled source: {name}')
        if path.stat().st_size > 25 * 1024 * 1024:
            raise ValueError(f'Public asset exceeds the 25 MiB limit: {name}')
        files.append((path, name.as_posix()))
    if len(files) > 20000:
        raise ValueError('Public build exceeds the 20000-file limit')
    actual = {name for _, name in files}
    if any(name.startswith('maps/') for name in actual) and not map_paths.issubset(actual):
        raise ValueError('Incomplete offline map assets: ' + ', '.join(sorted(map_paths - actual)))
    return files


def self_test():
    test_root = ROOT / '.test-artifacts'
    test_root.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='release-package-', dir=test_root) as tmp:
        folder = Path(tmp)
        assert folder.resolve().parent == test_root.resolve()
        (folder / 'index.html').write_text('synthetic', encoding='utf-8')
        assert [name for _, name in public_files(folder)] == ['index.html']
        for name in ['library.json', '.env', 'assets/personal.sqlite3', 'assets/personal.jpg']:
            path = folder / name
            path.parent.mkdir(exist_ok=True)
            path.write_text('synthetic private fixture', encoding='utf-8')
            try:
                public_files(folder)
            except ValueError:
                pass
            else:
                raise AssertionError(f'Private fixture was accepted: {name}')
            path.unlink()
    print('Release allowlist check passed; private fixtures were refused.')


def package():
    version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    if json.loads((ROOT / 'frontend/package.json').read_text(encoding='utf-8'))['version'] != version:
        raise ValueError('Root and frontend versions differ')
    folder = ROOT / 'frontend/dist-web'
    files = public_files(folder)
    if not PUBLIC_FILES.issubset({name for _, name in files}):
        raise ValueError('The browser build is missing required public files')
    if not bundled_map_paths().issubset({name for _, name in files}):
        raise ValueError('The browser build is missing offline map assets')
    if not any(RELAY_URL in path.read_text(encoding='utf-8')
               for path, name in files if name.startswith('assets/') and name.endswith('.js')):
        raise ValueError('Rebuild with VITE_ART_RELAY_URL=' + RELAY_URL)
    relay = [(ROOT / name, name) for name in RELAY_FILES]
    if any(not path.is_file() or path.is_symlink() for path, _ in relay):
        raise ValueError('A relay source or deployment file is missing or linked')
    now = datetime.now(timezone.utc)
    out = ROOT / 'releases' / f'PhotoCollection-Web-{version}-{now:%Y%m%dT%H%M%SZ}'
    out.mkdir(parents=True, exist_ok=False)
    files.append((ROOT / 'LICENSE', 'licenses/PhotoCollection-MIT.txt'))
    manifest = {'version': version, 'built_at_utc': now.isoformat(),
                'website': 'https://photomanagement.online', 'relay': RELAY_URL,
                'publicly_deployed': False, 'packages': []}
    for name, entries in [('browser-static.zip', files), ('relay-server.zip', relay)]:
        target = out / name
        with ZipFile(target, 'w', compression=ZIP_DEFLATED) as archive:
            for source, relative in entries:
                archive.write(source, relative)
        manifest['packages'].append({'file': name, 'files': len(entries),
                                     'bytes': target.stat().st_size,
                                     'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
    (out / 'release-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    (out / 'SHA256SUMS.txt').write_text(''.join(f"{x['sha256']}  {x['file']}\n" for x in manifest['packages']), encoding='ascii')
    print(json.dumps({'directory': str(out), **manifest}, indent=2))


if __name__ == '__main__':
    if sys.argv[1:] == ['--self-test']:
        self_test()
    elif not sys.argv[1:]:
        package()
    else:
        raise SystemExit('Usage: package-browser-release.py [--self-test]')
