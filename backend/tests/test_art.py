import base64
import hashlib
import json
import time
from io import BytesIO
from threading import Event
import pytest
from PIL import Image
from sqlalchemy import select
from backend.app.art_schemas import ArtLayout
from backend.app.config import DATA, EXPORTS
from backend.app.models import Session, Photo, Artwork, engine, initialize
from backend.app.services import art_service as art, art_credentials, jobs, import_service
from backend.migrate_storage import migrate
from backend.tests.test_library import import_paths, wait_job


def photo(client, image_factory):
    path = image_factory()
    import_paths(client, [path])
    return path, client.get('/api/photos').json()['photos'][0]


@pytest.fixture
def provider(monkeypatch):
    calls = []
    monkeypatch.setenv('OPENAI_API_KEY', 'test-only-secret-not-a-real-key')

    def request(endpoint, **kwargs):
        calls.append((endpoint, kwargs))
        if endpoint == 'responses':
            result = {'suggestions': [{'title': '旅途一刻', 'evidence': '画面内容；未确认地点'}]}
            return {'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': json.dumps(result)}]}]}
        image = kwargs['files']['image'][1]
        with Image.open(BytesIO(image)) as im:
            assert not im.getexif()
            assert kwargs['data']['size'] == f'{im.width}x{im.height}'
        # Contract test only: deliberately echo the input, not a visual quality simulation.
        return {'data': [{'b64_json': base64.b64encode(image).decode()}]}

    monkeypatch.setattr(art, 'request_api', request)
    return calls


def generate(client, photo_id, **layout):
    response = client.post('/api/art/generate', json={'photo_id': photo_id, 'title_confirmed': True, 'layout': layout})
    assert response.status_code == 202, response.text
    job = wait_job(client, response.json())
    return client.get('/api/art/works/' + job['artwork_id']).json()


def test_generate_title_edit_export_restart_migrate_delete(client, image_factory, provider, tmp_path):
    path, p = photo(client, image_factory)
    original = hashlib.sha256(path.read_bytes()).hexdigest()
    titles = client.post('/api/art/titles', json={'photo_id': p['id'], 'keywords': '河边'}).json()
    assert wait_job(client, titles)['suggestions'][0]['title'] == '旅途一刻'
    sent = provider[0][1]['json']
    assert sent['store'] is False and 'gps' not in sent['input'][0]['content'][0]['text'].lower()
    assert client.post('/api/art/generate', json={'photo_id': p['id'], 'title_confirmed': False}).status_code == 422
    work = generate(client, p['id'], title='旅途一刻', title_source='suggested', title_evidence='画面内容；未确认地点')
    assert work['layout']['title_evidence'] == '画面内容；未确认地点'
    assert len(provider) == 2 and work['width'] / work['height'] == 640 / 480
    assert work['generation']['usage'] is None
    assert client.get(work['preview_url']).status_code == 200
    assert client.get('/api/photos').json()['total'] == 1
    modified = work['layout'] | {'title': '准确的中文标题', 'layout': 'reference', 'paper': .6}
    preview = client.post('/api/art/works/' + work['id'] + '/preview', json=modified)
    assert preview.status_code == 200 and preview.headers['content-type'] == 'image/webp'
    update = {'revision': work['revision'], 'layout': modified}
    changed = client.put('/api/art/works/' + work['id'], json=update).json()
    assert changed['revision'] == 2 and changed['layout']['title'] == '准确的中文标题'
    assert client.put('/api/art/works/' + work['id'], json=update).status_code == 409
    assert len(provider) == 2
    a = client.post('/api/art/works/' + work['id'] + '/export', json={'format': 'png'}).json()
    b = client.post('/api/art/works/' + work['id'] + '/export', json={'format': 'png'}).json()
    assert a['path'] != b['path'] and client.get(a['url']).status_code == 200
    assert client.get(a['url']).content == client.get(changed['poster_url']).content
    engine.dispose(); initialize()
    assert client.get('/api/art/works/' + work['id']).json()['layout'] == modified
    destination = tmp_path / 'moved'
    migrate(DATA, destination)
    assert (destination / 'artworks' / work['id'] / 'scene.png').is_file()
    assert (destination / 'artworks' / work['id'] / 'poster-2.png').is_file()
    excluded = wait_job(client, jobs.submit('scan', import_service.import_paths, [str(DATA / 'artworks')], True, True))
    assert excluded['success'] == 0
    assert client.delete('/api/photos/' + p['id']).status_code == 200
    orphan = client.get('/api/art/works/' + work['id']).json()
    assert orphan['photo_id'] is None and client.get(orphan['poster_url']).status_code == 200
    assert client.delete('/api/art/works/' + work['id']).status_code == 200
    assert not art.folder_for(work['id']).exists()
    assert client.get(a['url']).status_code == 200
    assert hashlib.sha256(path.read_bytes()).hexdigest() == original


@pytest.mark.parametrize('size', [(1200, 800), (800, 1200), (700, 700), (2400, 200), (200, 2400)])
def test_layout_keeps_ratio_and_edge_subjects(size):
    scene = Image.new('RGB', size, (20, 50, 80))
    for name, fraction in [('airy', .55), ('reference', .85)]:
        output = art.poster(scene, size, ArtLayout(layout=name, title='漓江竹筏'))
        assert abs(output.width / output.height - size[0] / size[1]) <= 1 / output.height
        # Entire rectangular scene remains present; no feather mask discards edge subjects.
        bounds = output.point(lambda p: 255 if p < 100 else 0).getbbox()
        assert bounds and bounds[0] > 0 and bounds[2] < output.width
        assert output.getpixel((0, 0))[0] > 240


def test_cancel_and_reject_duplicate_without_blocking_imports(client, image_factory, provider, monkeypatch):
    _, p = photo(client, image_factory)
    entered, release = Event(), Event()
    original_request = art.request_api
    def blocked(*args, **kwargs):
        entered.set()
        assert release.wait(8)
        return original_request(*args, **kwargs)
    monkeypatch.setattr(art, 'request_api', blocked)
    payload = {'photo_id': p['id'], 'title_confirmed': True}
    job = client.post('/api/art/generate', json=payload).json()
    try:
        assert entered.wait(3)
        assert client.post('/api/art/generate', json=payload).status_code == 409
        parallel = import_paths(client, [image_factory('another.jpg', color=(10, 20, 30))])
        assert parallel['success'] == 1
        assert client.post('/api/jobs/' + job['id'] + '/cancel').status_code == 200
    finally:
        release.set()
    for _ in range(200):
        state = client.get('/api/jobs/' + job['id']).json()
        if state['status'] == 'cancelled': break
        time.sleep(.02)
    assert state['status'] == 'cancelled'
    assert client.get('/api/art/works').json()['total'] == 0


def test_key_is_protected_and_never_returned(client, monkeypatch, tmp_path):
    import os
    monkeypatch.delenv('OPENAI_API_KEY', raising=False)
    monkeypatch.setattr(art_credentials, 'KEY_FILE', tmp_path / 'key.dpapi')
    secret = 'test-only-watercolor-secret'
    invalid = client.put('/api/art/settings', json={'api_key': {'private': secret}})
    assert invalid.status_code == 422 and secret not in invalid.text
    if os.name == 'nt':
        response = client.put('/api/art/settings', json={'api_key': secret})
        assert response.status_code == 200, response.text
        assert secret not in response.text and secret.encode() not in art_credentials.KEY_FILE.read_bytes()
        assert art_credentials.get_key() == secret
    else:
        assert client.put('/api/art/settings', json={'api_key': secret}).status_code == 400
    assert client.put('/api/art/settings', json={'clear_key': True}).status_code == 200
    assert not art_credentials.KEY_FILE.exists()
    assert client.get('/api/art/settings').json()['configured'] is False


def test_provider_failure_redacts_key_and_does_not_retry(monkeypatch):
    import httpx
    monkeypatch.setenv('OPENAI_API_KEY', 'private-api-key')
    count = []
    def failure(*args, **kwargs):
        count.append(1)
        raise httpx.ReadTimeout('private-api-key in untrusted exception')
    monkeypatch.setattr(httpx.Client, 'stream', failure)
    with pytest.raises(ValueError) as error:
        art.request_api('images/edits')
    assert 'private-api-key' not in str(error.value) and 'timed out' in str(error.value)
    assert len(count) == 1


def test_invalid_result_fails_without_artwork(client, image_factory, provider, monkeypatch):
    _, p = photo(client, image_factory)
    monkeypatch.setattr(art, 'request_api', lambda *a, **kw: {'data': []})
    response = client.post('/api/art/generate', json={'photo_id': p['id'], 'title_confirmed': True}).json()
    for _ in range(200):
        state = client.get('/api/jobs/' + response['id']).json()
        if state['status'] == 'failed': break
        time.sleep(.02)
    assert state['status'] == 'failed'
    assert client.get('/api/art/works').json()['total'] == 0
    assert client.get('/api/art/works/not-an-id/scene').status_code == 404
    with pytest.raises(ValueError):
        art.folder_for('../../settings')
