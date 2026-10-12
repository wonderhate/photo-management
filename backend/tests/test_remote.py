import hashlib
import time
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app import remote
from test_library import import_paths

def test_phone_browses_computer_files_and_imports_without_native_dialog(client, image_factory, monkeypatch, tmp_path):
    from backend.app import file_browser
    monkeypatch.setattr(remote, 'CONFIG', tmp_path / 'remote.json')
    monkeypatch.setattr(file_browser, 'PAGE_SIZE', 1)
    remote.attempts.clear()
    folder = tmp_path / 'Computer Photos #一'
    folder.mkdir()
    (folder / 'Trip').mkdir()
    original = image_factory('phone-select-original.jpg')
    original = original.rename(folder / original.name)
    second = folder / 'second.PNG'
    second.write_bytes(original.read_bytes())
    (folder / 'private.txt').write_text('not a photo', encoding='utf-8')
    digest = hashlib.sha256(original.read_bytes()).hexdigest()
    with TestClient(app, base_url='http://192.168.1.20:8000', client=('192.168.1.21', 4000)) as phone:
        assert phone.get('/api/files/browse').status_code == 403
        code = client.put('/api/remote/settings', json={'enabled': True}).json()['pairing_code']
        assert phone.get('/api/files/browse').status_code == 401
        assert phone.post('/api/remote/connect', json={'code': code}).status_code == 200
        assert phone.post('/api/dialog/files').status_code == 403
        roots = phone.get('/api/files/browse')
        assert roots.status_code == 200 and roots.json()['entries']
        listing = phone.get('/api/files/browse', params={'path': str(folder)})
        assert 'no-store' in listing.headers['Cache-Control']
        assert listing.json()['entries'][0]['name'] == 'Trip'
        assert listing.json()['pages'] == 3 and listing.json()['total'] == 3
        files = [phone.get('/api/files/browse', params={'path': str(folder), 'page': page}).json()['entries'][0] for page in (2, 3)]
        assert {entry['name'] for entry in files} == {original.name, second.name}
        assert all('content' not in entry for entry in files)
        directories = phone.get('/api/files/browse', params={'path': str(folder), 'directories_only': True}).json()
        assert directories['total'] == 1 and directories['parent'] == str(folder.parent)
        for value in ['relative/path', str(folder / 'missing'), str(original), '\\\\remote-host\\share']:
            assert phone.get('/api/files/browse', params={'path': value}).status_code in (400, 404)
        assert phone.get('/api/files/browse', params={'path': str(folder), 'page': 0}).status_code == 400
        previous_imports = set((remote.DATA / 'imports').rglob('*'))
        import_paths(phone, [original])
        photo = client.get('/api/photos').json()['photos'][0]
        assert photo['file_path'] == str(original.resolve())
        assert hashlib.sha256(original.read_bytes()).hexdigest() == digest
        assert set((remote.DATA / 'imports').rglob('*')) == previous_imports
        client.put('/api/remote/settings', json={'enabled': False})
        assert phone.get('/api/files/browse', params={'path': str(folder)}).status_code == 403


def test_pairing_addresses_include_private_vpn_and_actual_port(client, monkeypatch, tmp_path):
    monkeypatch.setattr(remote, 'CONFIG', tmp_path / 'remote.json')
    hosts = ['192.168.1.20', '100.64.1.20', '192.168.1.20', '127.0.0.1',
             '169.254.1.20', '0.0.0.0', '239.1.1.1', '8.8.8.8']
    monkeypatch.setattr(remote.socket, 'getaddrinfo', lambda *args: [
        (remote.socket.AF_INET, remote.socket.SOCK_STREAM, 6, '', (host, 0)) for host in hosts])
    access = client.get('/api/remote/settings', headers={'Host': 'localhost:8123'}).json()
    assert access['enabled'] is False
    assert access['pairing_code'] == ''
    assert access['addresses'] == ['http://100.64.1.20:8123', 'http://192.168.1.20:8123']
    assert access['public_addresses'] == []


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


def test_public_address_registration_is_local_only_and_validated(client, monkeypatch, tmp_path):
    monkeypatch.setattr(remote, 'CONFIG', tmp_path / 'remote.json')
    with TestClient(app, base_url='http://192.168.1.20:8000', client=('192.168.1.21', 4000)) as phone:
        assert phone.post('/api/remote/public-addresses', json={'address': 'https://photos.example.com'}).status_code == 403
        assert phone.delete('/api/remote/public-addresses', params={'address': 'https://photos.example.com'}).status_code == 403
    for invalid in ['http://photos.example.com', 'https://photos.example.com/gallery', 'https://user@photos.example.com',
                    'https://192.168.1.20', 'https://100.64.1.20', 'https://localhost', 'ftp://photos.example.com',
                    'photos.example.com', 'https://4444::1', '']:
        assert client.post('/api/remote/public-addresses', json={'address': invalid}).status_code == 400, invalid
    access = client.post('/api/remote/public-addresses', json={'address': 'https://Photos.Example.COM:8443'}).json()
    assert access['public_addresses'] == ['https://photos.example.com:8443']
    assert client.post('/api/remote/public-addresses', json={'address': 'https://photos.example.com:8443/'}).status_code == 409
    assert client.post('/api/remote/public-addresses', json={'address': 'https://[4444::1]'}).json()['public_addresses'] == [
        'https://[4444::1]', 'https://photos.example.com:8443']
    client.put('/api/remote/settings', json={'enabled': True})
    assert client.get('/api/remote/settings').json()['public_addresses'] == ['https://[4444::1]', 'https://photos.example.com:8443']


def test_registered_public_host_pairs_over_reverse_proxy(client, monkeypatch, tmp_path):
    monkeypatch.setattr(remote, 'CONFIG', tmp_path / 'remote.json')
    remote.attempts.clear()
    assert client.post('/api/remote/public-addresses', json={'address': 'https://photos.example.com'}).status_code == 200
    # base_url http 模拟反向代理终结 TLS 后 uvicorn 看到的请求；Secure cookie 由已登记主机推导。
    with TestClient(app, base_url='http://photos.example.com', client=('203.0.113.7', 5000)) as phone:
        assert phone.get('/api/photos').status_code == 403
        code = client.put('/api/remote/settings', json={'enabled': True}).json()['pairing_code']
        assert phone.get('/api/photos').status_code == 401
        paired = phone.post('/api/remote/connect', json={'code': code})
        assert paired.status_code == 200 and 'secure' in paired.headers['set-cookie'].lower()
        cookie = paired.headers['set-cookie'].split(';')[0]
        assert phone.get('/api/photos', headers={'Cookie': cookie}).status_code == 200
        assert 'strict-transport-security' in phone.get('/api/health', headers={'Cookie': cookie}).headers
        assert phone.get('/api/health', headers={'Host': 'evil.example', 'Cookie': cookie}).status_code == 400
    assert client.delete('/api/remote/public-addresses', params={'address': 'https://photos.example.com'}).status_code == 200
    with TestClient(app, base_url='http://photos.example.com', client=('203.0.113.7', 5000)) as phone:
        assert phone.get('/api/photos').status_code == 400


def test_public_origin_allowed_for_registered_host_writes(client, image_factory, monkeypatch, tmp_path):
    monkeypatch.setattr(remote, 'CONFIG', tmp_path / 'remote.json')
    remote.attempts.clear()
    client.post('/api/remote/public-addresses', json={'address': 'https://photos.example.com'})
    code = client.put('/api/remote/settings', json={'enabled': True}).json()['pairing_code']
    import_paths(client, [image_factory('public-origin.jpg')])
    photo = client.get('/api/photos').json()['photos'][0]
    with TestClient(app, base_url='http://photos.example.com:8000', client=('203.0.113.7', 5000)) as phone:
        paired = phone.post('/api/remote/connect', json={'code': code})
        assert paired.status_code == 200
        cookie = paired.headers['set-cookie'].split(';')[0]
        assert phone.post('/api/watermark/preview', json={'photo_id': photo['id'], 'options': {}},
                          headers={'Origin': 'https://photos.example.com', 'Cookie': cookie}).status_code == 200
        assert phone.post('/api/backup', headers={'Origin': 'https://evil.example', 'Cookie': cookie}).status_code == 403
        assert phone.post('/api/backup', headers={'Origin': 'http://photos.example.com', 'Cookie': cookie}).status_code == 403


def test_pairing_code_global_lockout_persists(client, monkeypatch, tmp_path):
    monkeypatch.setattr(remote, 'CONFIG', tmp_path / 'remote.json')
    remote.attempts.clear()
    code = client.put('/api/remote/settings', json={'enabled': True}).json()['pairing_code']
    wrong = '00000000' if code != '00000000' else '11111111'
    with TestClient(app, base_url='http://100.64.1.20:8000', client=('100.64.1.21', 4000)) as phone:
        for _ in range(10):
            remote.attempts.clear()
            assert phone.post('/api/remote/connect', json={'code': wrong}).status_code == 401
        remote.attempts.clear()
        assert phone.post('/api/remote/connect', json={'code': code}).status_code == 429
        saved = remote.read_config()
        assert saved['pairing_failures'] == 10 and saved['pairing_locked_until'] > time.time()
        new_code = client.put('/api/remote/settings', json={'enabled': True}).json()['pairing_code']
        remote.attempts.clear()
        assert phone.post('/api/remote/connect', json={'code': new_code}).status_code == 200
        assert remote.read_config()['pairing_failures'] == 0
