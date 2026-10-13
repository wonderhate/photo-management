from fastapi.testclient import TestClient
from backend.app.main import app


def test_local_access_rejects_network_hosts_and_proxy_markers(client):
    assert client.get('/api/health').status_code == 200
    for host in ['192.168.1.20:8000', 'photos.example.com', '8.8.8.8']:
        headers = {'Host':host, 'Cookie':'photo_remote=retired-session'}
        assert client.get('/api/health', headers=headers).status_code == 400
    for marker in ['Forwarded', 'X-Forwarded-For', 'X-Forwarded-Proto', 'X-Real-IP', 'CF-Connecting-IP', 'Tailscale-Funnel-Request']:
        assert client.get('/api/health', headers={marker:'127.0.0.1'}).status_code == 403
    assert client.post('/api/backup', headers={'Origin':'https://evil.example'}).status_code == 403
    with TestClient(app, base_url='http://localhost:8000', client=('172.17.0.1', 4000)) as container:
        assert container.get('/api/health').status_code == 200


def test_phone_pairing_and_network_file_browser_are_absent(client):
    for path in ['/api/remote/settings', '/api/remote/session', '/api/files/browse']:
        assert client.get(path).status_code == 404
    assert client.post('/api/remote/connect', json={'code':'12345678'}).status_code in (404, 405)
    paths = client.get('/openapi.json').json()['paths']
    assert not any(path.startswith('/api/remote/') or path == '/api/files/browse' for path in paths)
