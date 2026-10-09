import os
import tempfile
from pathlib import Path
import pytest

_test_root = Path(__file__).resolve().parents[2] / '.test-artifacts'
_test_root.mkdir(exist_ok=True)
_test_directory = tempfile.TemporaryDirectory(prefix='photo-library-pytest-', dir=_test_root)
os.environ['PHOTO_DATA_DIR'] = str(Path(_test_directory.name) / 'library')
os.environ['PHOTO_AUTOLOAD_AI'] = '0'

from backend.app.main import app
from backend.app.models import initialize, Base, engine
from fastapi.testclient import TestClient

@pytest.fixture(scope='session', autouse=True)
def close_database():
    yield
    engine.dispose()
    assert Path(_test_directory.name).resolve().parent == _test_root.resolve()
    _test_directory.cleanup()

@pytest.fixture
def client():
    Base.metadata.drop_all(engine)
    initialize()
    with TestClient(app) as test_client:
        yield test_client

@pytest.fixture
def image_factory(tmp_path):
    from PIL import Image, TiffImagePlugin
    def create(name='DSC0001.jpg', camera='ILCE-7M4', lens='FE 85mm F1.4 GM', focal=85, month=9, day=29, color=(185,110,40)):
        target = tmp_path / name
        image = Image.new('RGB', (640,480), color)
        exif = Image.Exif()
        for key,value in {271:'SONY',272:camera,42036:lens,36867:f'2026:{month:02}:{day:02} 18:24:00',
                          33437:TiffImagePlugin.IFDRational(28,10),33434:TiffImagePlugin.IFDRational(1,500),
                          34855:100,37386:TiffImagePlugin.IFDRational(focal*10,10),41989:85,274:1}.items():
            exif[key]=value
        image.save(target, exif=exif)
        return target
    return create
