import hashlib
import time
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app import remote
from test_library import import_paths


def test_paired_phone_edits_desktop_draft_and_export_without_cached_images(client, image_factory, monkeypatch, tmp_path):
    monkeypatch.setattr(remote, 'CONFIG', tmp_path / 'remote.json')
    remote.attempts.clear()
    original = image_factory('remote-source.jpg')
    digest = hashlib.sha256(original.read_bytes()).hexdigest()
    import_paths(client, [original])
    photo = client.get('/api/photos').json()['photos'][0]
    with TestClient(app, base_url='http://192.168.1.20:8000', client=('192.168.1.21', 4000)) as phone:
        assert phone.get('/api/photos').status_code == 403
        access = client.put('/api/remote/settings', json={'enabled': True}).json()
        assert phone.get('/api/photos').status_code == 401
        assert phone.post('/api/remote/connect', json={'code': 'x' * 8}).status_code == 422
        assert phone.post('/api/remote/connect', json={'code': access['pairing_code']}).status_code == 200
        assert phone.get('/api/remote/settings').status_code == 403
        assert phone.post('/api/backup', headers={'Origin': 'https://evil.example'}).status_code == 403
        assert phone.patch('/api/photos/' + photo['id'], json={'favorite': True, 'tags': ['手机整理']}).status_code == 200
        assert client.get('/api/photos/' + photo['id']).json()['favorite'] is True
        thumbnail = phone.get(photo['thumbnail_url'])
        assert thumbnail.status_code == 200 and 'no-store' in thumbnail.headers['Cache-Control']
        preview = phone.post('/api/watermark/preview', json={'photo_id': photo['id'], 'options': {}})
        assert preview.status_code == 200 and 'no-store' in preview.headers['Cache-Control']
        draft = phone.post('/api/watermark/drafts', json={'photo_id': photo['id'], 'name': '手机创作', 'settings_json': {}}).json()
        assert client.get('/api/watermark/drafts/' + draft['id']).json()['name'] == '手机创作'
        result = phone.post('/api/watermark/drafts/' + draft['id'] + '/export', json={})
        assert result.status_code == 200, result.text
        exported = phone.get(result.json()['url'])
        assert exported.status_code == 200 and exported.headers['content-type'].startswith('image/')
        assert 'no-store' in exported.headers['Cache-Control']
        assert hashlib.sha256(original.read_bytes()).hexdigest() == digest
        client.put('/api/remote/settings', json={'enabled': False})
        assert phone.get('/api/photos').status_code == 403
        assert client.get('/api/photos').status_code == 200


def test_pair_expiry_rate_limit_and_rebinding(client, monkeypatch, tmp_path):
    monkeypatch.setattr(remote, 'CONFIG', tmp_path / 'remote.json')
    remote.attempts.clear()
    code = client.put('/api/remote/settings', json={'enabled': True}).json()['pairing_code']
    with TestClient(app, base_url='http://100.64.1.20:8000', client=('100.64.1.21', 4000)) as phone:
        wrong = '00000000' if code != '00000000' else '11111111'
        for _ in range(5):
            assert phone.post('/api/remote/connect', json={'code': wrong}).status_code == 401
        assert phone.post('/api/remote/connect', json={'code': code}).status_code == 429
        remote.attempts.clear()
        config = remote.read_config();config['pairing_expires'] = time.time() - 1;remote.write_config(config)
        assert phone.post('/api/remote/connect', json={'code': code}).status_code == 401
    assert client.get('/api/health', headers={'Host': 'evil.example'}).status_code == 400
    assert client.get('/api/health', headers={'Host': '192.168.1.20', 'X-Forwarded-For': '127.0.0.1'}).status_code == 401
