"""Release map allowlists include the full public Earth, never arbitrary files."""
import importlib.util
import json
import shutil
import tempfile
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(params=['browser', 'showcase'])
def packaged_map(request):
    product = request.param
    script = ROOT / ('frontend/scripts/package-browser-release.py' if product == 'browser'
                     else 'web/frontend/scripts/package-showcase.py')
    spec = importlib.util.spec_from_file_location('map_package_' + product, script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    artifacts = ROOT / '.test-artifacts'
    artifacts.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='map-package-', dir=artifacts) as tmp:
        folder = Path(tmp)
        assert folder.resolve().parent == artifacts.resolve()
        (folder / 'index.html').write_text('synthetic document', encoding='utf-8')
        (folder / 'assets').mkdir()
        (folder / 'assets/main.js').write_text('"wss://ai.photomanagement.online/cloud-art"', encoding='utf-8')
        if product == 'showcase':
            (folder / 'windows.html').write_text('synthetic download', encoding='utf-8')
            (folder / 'portfolio').mkdir()
            (folder / 'portfolio/manifest.json').write_text(json.dumps({'photos': []}), encoding='utf-8')
        for relative in module.bundled_map_paths():
            target = folder / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(module.ROOT / 'frontend/public' / relative, target)
        validate = module.public_files if product == 'browser' else module.validate_public
        yield folder, validate, module


def test_complete_map_assets_and_credit_are_accepted(packaged_map):
    folder, validate, module = packaged_map
    assert len(module.bundled_map_paths()) == 692
    result = validate(folder)
    records = result if isinstance(result, list) else result[0]
    names = {record[1] if isinstance(record, tuple) else record.relative_to(folder).as_posix()
             for record in records}
    assert module.bundled_map_paths().issubset(names)


def test_map_contents_must_match_registered_sources(packaged_map):
    folder, validate, _module = packaged_map
    for relative in ['maps/earth/4/31-15.jpg', 'maps/earth/metadata.json',
                     'maps/satellite.js', 'licenses/nasa-blue-marble.json']:
        path = folder / relative
        original = path.read_bytes()
        path.write_bytes(b'synthetic private replacement')
        with pytest.raises(ValueError, match='does not match its bundled source'):
            validate(folder)
        path.write_bytes(original)


def test_map_is_complete_including_attribution(packaged_map):
    folder, validate, _module = packaged_map
    for relative in ['maps/earth/0/0-0.jpg', 'maps/earth/4/31-15.jpg',
                     'maps/earth/SHA256SUMS.txt', 'licenses/nasa-blue-marble.json']:
        path = folder / relative
        original = path.read_bytes()
        path.unlink()
        with pytest.raises(ValueError, match='Incomplete offline map assets'):
            validate(folder)
        path.write_bytes(original)


def test_unregistered_map_paths_cannot_enter_release(packaged_map):
    folder, validate, _module = packaged_map
    for relative in ['maps/earth/4/99-99.jpg', 'maps/earth/private.json',
                     'maps/private.sqlite3', 'maps/new-bridge.js']:
        path = folder / relative
        path.write_bytes(b'synthetic unregistered private fixture')
        with pytest.raises(ValueError, match='Unexpected public'):
            validate(folder)
        path.unlink()
