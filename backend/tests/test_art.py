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
    monkeypatch.setenv('DASHSCOPE_API_KEY', 'test-only-secret-not-a-real-key')

    def request(**kwargs):
        calls.append((art.API_URL, kwargs))
        body = kwargs['json']
        content = body['input']['messages'][0]['content']
        if body['model'].startswith('qwen3-vl'):
            result = {'suggestions': [{'title': '旅途一刻', 'evidence': '画面内容；未确认地点'}]}
            return {'output': {'choices': [{'message': {'content': [{'text': json.dumps(result)}]}}]}}
        image = base64.b64decode(content[0]['image'].split(',', 1)[1])
        with Image.open(BytesIO(image)) as im:
            assert not im.getexif()
            assert body['parameters']['size'] == f'{im.width}*{im.height}'
            assert body['parameters']['n'] == 1 and body['parameters']['watermark'] is False
            assert '保持原构图' in content[1]['text']
        # Contract test only: deliberately echo the input, not a visual quality simulation.
        return {'output': {'choices': [{'message': {'content': [{'image': 'data:image/png;base64,' + base64.b64encode(image).decode()}]}}]}}

    monkeypatch.setattr(art, 'request_api', request)
    return calls


def generate(client, photo_id, **layout):
    response = client.post('/api/art/generate', json={'cloud_confirmed': True, 'photo_id': photo_id, 'title_confirmed': True, 'layout': layout})
    assert response.status_code == 202, response.text
    job = wait_job(client, response.json())
    return client.get('/api/art/works/' + job['artwork_id']).json()


def test_generate_title_edit_export_restart_migrate_delete(client, image_factory, provider, tmp_path):
    path, p = photo(client, image_factory)
    original = hashlib.sha256(path.read_bytes()).hexdigest()
    titles = client.post('/api/art/titles', json={'cloud_confirmed': True, 'photo_id': p['id'], 'keywords': '河边'}).json()
    assert wait_job(client, titles)['suggestions'][0]['title'] == '旅途一刻'
    sent = provider[0][1]['json']
    context = json.loads(sent['input']['messages'][0]['content'][1]['text'].split('\nContext: ')[1])
    assert set(context) == {'user_keywords', 'date_taken', 'language'}
    assert context['language'] == 'zh'
    assert '所有 title 标题和 evidence 说明必须使用简体中文' in sent['input']['messages'][0]['content'][1]['text']
    assert client.post('/api/art/generate', json={'cloud_confirmed': True, 'photo_id': p['id'], 'title_confirmed': False}).status_code == 422
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
    assert orphan['photo_id'] == p['id'] and client.get(orphan['poster_url']).status_code == 200
    assert client.delete('/api/art/works/' + work['id']).status_code == 200
    assert art.folder_for(work['id']).exists()  # Await explicit recoverable collection.
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
    payload = {'cloud_confirmed': True, 'photo_id': p['id'], 'title_confirmed': True}
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
    monkeypatch.delenv('DASHSCOPE_API_KEY', raising=False)
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
    monkeypatch.setenv('DASHSCOPE_API_KEY', 'private-api-key')
    count = []
    def failure(*args, **kwargs):
        count.append(1)
        raise httpx.ReadTimeout('private-api-key in untrusted exception')
    monkeypatch.setattr(httpx.Client, 'stream', failure)
    with pytest.raises(ValueError) as error:
        art.request_api(json={})
    assert 'private-api-key' not in str(error.value) and 'timed out' in str(error.value)
    assert len(count) == 1


def test_invalid_result_fails_without_artwork(client, image_factory, provider, monkeypatch):
    _, p = photo(client, image_factory)
    monkeypatch.setattr(art, 'request_api', lambda *a, **kw: {'data': []})
    response = client.post('/api/art/generate', json={'cloud_confirmed': True, 'photo_id': p['id'], 'title_confirmed': True}).json()
    for _ in range(200):
        state = client.get('/api/jobs/' + response['id']).json()
        if state['status'] == 'failed': break
        time.sleep(.02)
    assert state['status'] == 'failed'
    assert client.get('/api/art/works').json()['total'] == 0
    assert client.get('/api/art/works/not-an-id/scene').status_code == 404
    with pytest.raises(ValueError):
        art.folder_for('../../settings')


def test_watermark_uses_pinned_poster_and_survives_original_removal(client, image_factory, provider, tmp_path):
    from backend.app.services import watermark_draft_service, watermark_service
    path, p = photo(client, image_factory)
    work = generate(client, p['id'], title='旅途水彩')
    response = client.post('/api/art/works/' + work['id'] + '/watermark')
    assert response.status_code == 201, response.text
    draft = response.json()
    assert draft['artwork_id'] == work['id'] and draft['source']['artwork_revision'] == 1
    assert draft['source']['iso'] == p['iso']
    assert not draft['source_missing']
    assert client.get(draft['preview_url']).status_code == 200
    options = draft['settings_json'] | {'format': 'png', 'long_edge': 0, 'signature': '旅行', 'fields': ['signature']}
    assert client.post('/api/watermark/drafts/' + draft['id'] + '/render', json=options).status_code == 200
    update = client.put('/api/watermark/drafts/' + draft['id'], json={'revision': draft['revision'], 'settings_json': options})
    assert update.status_code == 200, update.text
    copy = client.post('/api/watermark/drafts/' + draft['id'] + '/duplicate').json()
    assert copy['artwork_id'] == work['id']
    assert client.delete('/api/art/works/' + work['id']).status_code == 409
    assert client.put('/api/art/works/' + work['id'], json={'revision': 1, 'layout': work['layout'] | {'title': '修改之后', 'layout': 'reference'}}).status_code == 200
    assert client.delete('/api/photos/' + p['id']).status_code == 200
    assert client.get('/api/watermark/drafts/' + draft['id']).json()['source_missing'] is False
    with Session() as session:
        record = watermark_draft_service.get_draft(session, draft['id'])
        source = watermark_draft_service.draft_source(session, record)
        assert source.file_path.endswith('poster-1.png')
        expected = watermark_service.render(source, options)
    exported = client.post('/api/watermark/drafts/' + draft['id'] + '/export', json={}).json()
    with Image.open(exported['path']) as image:
        assert image.size == expected.size and image.tobytes() == expected.tobytes()
    moved = tmp_path / 'watercolor-moved'
    migrate(DATA, moved)
    assert (moved / 'artworks' / work['id'] / 'poster-1.png').is_file()
    assert client.post('/api/watermark/drafts/' + draft['id'] + '/relocate', json={'path': str(path)}).status_code == 409
    assert client.delete('/api/watermark/drafts/' + copy['id']).status_code == 200
    assert client.delete('/api/watermark/drafts/' + draft['id']).status_code == 200
    assert client.delete('/api/art/works/' + work['id']).status_code == 200
    assert path.exists() and client.get(exported['url']).status_code == 200


def test_legacy_drafts_gain_nullable_artwork_reference_with_backup(tmp_path):
    import sqlite3
    from backend.app.migrations import migrate_database
    path = tmp_path / 'legacy.db'
    with sqlite3.connect(path) as db:
        db.execute('CREATE TABLE watermark_drafts (id TEXT PRIMARY KEY, name TEXT)')
        db.execute("INSERT INTO watermark_drafts VALUES ('old', 'Keep my design')")
    assert migrate_database(path) == ['watermark_drafts.artwork_id', 'watermark_drafts.asset_variant_id']
    assert migrate_database(path) == []
    assert len(list((tmp_path / 'backups').glob('*.db'))) == 1
    with sqlite3.connect(path) as db:
        assert db.execute('SELECT name, artwork_id FROM watermark_drafts').fetchone() == ('Keep my design', None)
        assert {row[2] for row in db.execute('PRAGMA foreign_key_list(watermark_drafts)')} == {'artworks', 'asset_variants'}


@pytest.mark.parametrize('model,quality', [('qwen-image-3.0', 'low'), ('qwen-image-3.0', 'medium'), ('qwen-image-3.0-pro', 'high')])
def test_qwen_model_selection_reaches_generation(client, image_factory, provider, model, quality):
    _, p = photo(client, image_factory)
    assert client.put('/api/art/settings', json={'image_model': model}).status_code == 200
    assert client.get('/api/art/settings').json()['image_model'] == model
    response = client.post('/api/art/generate', json={'cloud_confirmed': True, 'photo_id': p['id'], 'title_confirmed': True, 'quality': quality}).json()
    job = wait_job(client, response)
    work = client.get('/api/art/works/' + job['artwork_id']).json()
    assert work['generation']['model'] == model
    body = provider[-1][1]['json']
    assert body['model'] == model
    assert body['parameters']['prompt_extend'] == (quality != 'low')
    assert body['parameters']['enable_thinking'] == (quality == 'high')
    assert client.put('/api/art/settings', json={'image_model': 'gpt-image-2'}).status_code == 422


def test_legacy_config_and_credentials_are_not_sent_to_qwen(client, monkeypatch, tmp_path):
    from backend.app import config
    old = tmp_path / 'settings.json'
    old.write_text(json.dumps({'art_image_model': 'gpt-image-2', 'art_title_model': 'gpt-4.1-mini', 'thumbnail_quality': 90}))
    monkeypatch.setattr(config, 'SETTINGS_FILE', old)
    monkeypatch.setattr(art_credentials, 'KEY_FILE', tmp_path / 'qwen-art-key.dpapi')
    (tmp_path / 'art-key.dpapi').write_bytes(b'old-openai-key')
    monkeypatch.delenv('DASHSCOPE_API_KEY', raising=False)
    monkeypatch.setenv('OPENAI_API_KEY', 'never-send-this-openai-key')
    result = client.get('/api/art/settings').json()
    assert not result['configured'] and result['provider'] == 'Qwen' and result['endpoint'] == art.API_URL
    assert result['image_model'] == 'qwen-image-3.0' and result['title_model'] == 'qwen3-vl-plus'
    assert config.settings()['thumbnail_quality'] == 90


def test_qwen_request_and_result_download_do_not_forward_credentials(monkeypatch):
    import httpx
    secret = 'test-only-qwen-secret'
    monkeypatch.setenv('DASHSCOPE_API_KEY', secret)
    calls = []
    url = 'https://dashscope-result-sz.oss-cn-shenzhen.aliyuncs.com/synthetic.png?Expires=123'
    output = BytesIO(); Image.new('RGB', (16, 16), 'blue').save(output, 'PNG')
    def handler(request):
        calls.append(request)
        if request.method == 'POST':
            assert str(request.url) == art.API_URL and request.headers['Authorization'] == 'Bearer ' + secret
            assert json.loads(request.content)['model'] == 'qwen-image-3.0-pro'
            return httpx.Response(200, json={'output': {'choices': [{'message': {'content': [{'image': url}]}}]}})
        assert str(request.url) == url and 'Authorization' not in request.headers
        return httpx.Response(200, content=output.getvalue())
    real = httpx.Client
    monkeypatch.setattr(httpx, 'Client', lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    result = art.request_api(json={'model': 'qwen-image-3.0-pro'})
    assert art.generated_image(result['output']['choices'][0]['message']['content'][0]['image']) == output.getvalue()
    assert len(calls) == 2
    for unsafe in ('http://localhost/result.png', 'https://127.0.0.1/result.png', 'file:///photo.jpg', 'https://evil.test/result.png'):
        with pytest.raises(ValueError): art.generated_image(unsafe)
    assert len(calls) == 2


@pytest.mark.parametrize('status,code,expected', [(429, 'Arrearage', '余额'), (429, 'Throttling', '受限'),
    (401, 'InvalidApiKey', '密钥'), (400, 'InvalidParameter.Model', '模型'), (200, 'DataInspectionFailed', '失败')])
def test_qwen_errors_are_specific_redacted_and_not_retried(monkeypatch, status, code, expected):
    import httpx
    secret = 'do-not-print-this-secret'
    monkeypatch.setenv('DASHSCOPE_API_KEY', secret)
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(status, json={'code': code, 'message': secret, 'request_id': secret})
    real = httpx.Client
    monkeypatch.setattr(httpx, 'Client', lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    with pytest.raises(ValueError) as error: art.request_api(json={})
    assert expected in str(error.value) and secret not in str(error.value) and len(calls) == 1


@pytest.mark.parametrize('with_titles', [False, True])
def test_batch_upload_generate_then_optional_titles(client, image_factory, provider, with_titles):
    paths = [image_factory('batch-a.jpg', color=(10, 30, 50)), image_factory('batch-b.jpg', color=(70, 90, 110))]
    hashes = [hashlib.sha256(path.read_bytes()).hexdigest() for path in paths]
    uploaded = client.post('/api/photos/upload', files=[('files', (path.name, path.read_bytes(), 'image/jpeg'))
                           for path in [*paths, paths[0]]])
    imported = wait_job(client, uploaded.json())
    ids = imported['photo_ids']
    assert len(ids) == 2 and imported['success'] == 2 and imported['skipped'] == 1
    assert client.post('/api/art/batch', json={'cloud_confirmed': True, 'photo_ids': []}).status_code == 422
    assert client.post('/api/art/batch', json={'cloud_confirmed': True, 'photo_ids': ids * 51}).status_code == 422
    assert client.post('/api/art/batch', json={'cloud_confirmed': True, 'photo_ids': [ids[0], 'missing']}).status_code == 400
    assert not provider
    response = client.post('/api/art/batch', json={'cloud_confirmed': True, 'photo_ids': [ids[0], ids[0], ids[1]],
                           'generate_titles': with_titles, 'language': 'en', 'layout': {'title': 'Do not repeat'}})
    assert response.status_code == 202, response.text
    job = wait_job(client, response.json())
    assert (job['total'], job['processed'], job['success'], job['failed']) == (2, 2, 2, 0)
    models = [call[1]['json']['model'] for call in provider]
    assert all(model.startswith('qwen-image') for model in models[:2])
    assert len(models) == (4 if with_titles else 2)
    assert all(model.startswith('qwen3-vl') for model in models[2:])
    assert job['title_processed'] == (2 if with_titles else 0)
    assert {item['photo_id'] for item in job['results']} == set(ids)
    for item in job['results']:
        work = client.get('/api/art/works/' + item['artwork_id']).json()
        assert work['layout']['title'] == ('旅途一刻' if with_titles else '')
        assert work['layout']['title_source'] == ('suggested' if with_titles else 'none')
        assert work['revision'] == (2 if with_titles else 1)
        assert client.get(work['poster_url']).status_code == 200
        assert (art.folder_for(work['id']) / 'poster-1.png').is_file()
    assert [hashlib.sha256(path.read_bytes()).hexdigest() for path in paths] == hashes


def test_batch_retains_images_when_generation_or_titles_fail(client, image_factory, provider, monkeypatch):
    paths = [image_factory('partial-a.jpg', color=(10, 40, 60)), image_factory('partial-b.jpg', color=(80, 90, 120))]
    import_paths(client, paths)
    ids = [p['id'] for p in client.get('/api/photos').json()['photos']]
    original_request, attempts = art.request_api, []
    def request(**kwargs):
        model = kwargs['json']['model']
        attempts.append(model)
        if model.startswith('qwen3-vl'):
            raise ValueError('Title service unavailable')
        if len(attempts) == 2:
            raise ValueError('Image service unavailable')
        return original_request(**kwargs)
    monkeypatch.setattr(art, 'request_api', request)
    job = wait_job(client, client.post('/api/art/batch', json={'cloud_confirmed': True, 'photo_ids': ids, 'generate_titles': True}).json())
    assert job['success'] == 1 and job['failed'] == 1 and len(attempts) == 3
    assert job['results'][1]['error'] == 'Image service unavailable'
    result = job['results'][0]
    assert result['title_status'] == 'failed' and result['title_error'] == 'Title service unavailable'
    work = client.get('/api/art/works/' + result['artwork_id']).json()
    assert work['layout']['title'] == '' and work['revision'] == 1
    assert client.get(work['poster_url']).status_code == 200


def test_batch_cancel_keeps_finished_work_and_stops_remaining_requests(client, image_factory, provider, monkeypatch):
    paths = [image_factory(f'cancel-{index}.jpg', color=(index * 50, 40, 60)) for index in range(3)]
    hashes = [hashlib.sha256(path.read_bytes()).hexdigest() for path in paths]
    import_paths(client, paths)
    ids = [p['id'] for p in client.get('/api/photos').json()['photos']]
    entered, release = Event(), Event()
    original_request, attempts = art.request_api, []
    def request(**kwargs):
        attempts.append(kwargs['json']['model'])
        if len(attempts) == 2:
            entered.set()
            assert release.wait(8)
        return original_request(**kwargs)
    monkeypatch.setattr(art, 'request_api', request)
    payload = {'cloud_confirmed': True, 'photo_ids': ids, 'generate_titles': True}
    job = client.post('/api/art/batch', json=payload).json()
    try:
        assert entered.wait(5)
        assert client.post('/api/art/batch', json=payload).status_code == 409
        assert client.post('/api/art/generate', json={'cloud_confirmed': True, 'photo_id': ids[0], 'title_confirmed': True}).status_code == 409
        client.post('/api/jobs/' + job['id'] + '/cancel')
    finally:
        release.set()
    for _ in range(200):
        state = client.get('/api/jobs/' + job['id']).json()
        if state['status'] == 'cancelled':
            break
        time.sleep(.02)
    assert state['status'] == 'cancelled' and len(attempts) == 2
    assert state['processed'] == state['success'] == 1
    assert client.get('/api/art/works').json()['total'] == 1
    assert client.get(state['results'][0]['url']).status_code == 200
    assert [hashlib.sha256(path.read_bytes()).hexdigest() for path in paths] == hashes
