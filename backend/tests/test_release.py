from test_library import import_paths
from pathlib import Path


def test_local_browser_security_headers(client):
    for path in ('/', '/watermark/gallery', '/api/health', '/api/missing'):
        response = client.get(path)
        assert response.headers['X-Content-Type-Options'] == 'nosniff'
        assert response.headers['X-Frame-Options'] == 'DENY'
        assert response.headers['Referrer-Policy'] == 'no-referrer'
        assert response.headers['Cross-Origin-Opener-Policy']=='same-origin'
        assert response.headers['Cross-Origin-Embedder-Policy']=='require-corp'
    policy = client.get('/').headers['Content-Security-Policy']
    assert "script-src 'self'" in policy and "frame-ancestors 'none'" in policy
    assert 'unsafe-eval' not in policy
    assert 'unsafe-eval' in client.get('/raw-1.6.0/worker.js').headers['Content-Security-Policy']
    assert 'Content-Security-Policy' not in client.get('/docs').headers
    blocked = client.post('/api/library/scan', headers={'Origin': 'https://untrusted.example'})
    assert blocked.status_code == 403 and blocked.headers['X-Frame-Options'] == 'DENY'
    assert client.get('/api/health', headers={'Host': 'untrusted.example'}).status_code == 400


def test_windows_powershell_scripts_use_bom_for_non_ascii():
    for script in Path(__file__).resolve().parents[2].glob('*.ps1'):
        content=script.read_bytes()
        if not content.decode('utf-8-sig').isascii():
            assert content.startswith(b'\xef\xbb\xbf'),script.name

def test_album_order_cover_compare_settings_and_routes(client,image_factory):
    paths=[image_factory(f'p{i}.jpg',color=(i,30,80)) for i in range(3)]
    import_paths(client,paths)
    ids=client.get('/api/photos/ids').json()['ids']
    album=client.post('/api/albums',json={'name':'Album','photo_ids':ids}).json()
    aid=album['id'];ordered=list(reversed(ids))
    assert client.put('/api/albums/'+aid+'/order',json={'photo_ids':ordered}).status_code==200
    assert client.get('/api/photos/ids',params={'album_id':aid,'sort':'manual'}).json()['ids']==ordered
    assert client.patch('/api/albums/'+aid,json={'cover_photo_id':ordered[0]}).json()['cover_id']==ordered[0]
    assert client.get('/api/compare',params={'ids':','.join(ids)}).status_code==200
    assert client.get('/api/compare',params={'ids':ids[0]}).status_code==400
    assert client.get('/api/compare',params={'ids':','.join(ids+['missing'])}).status_code==404
    assert client.post('/api/photos/by-ids',json={'ids':ordered}).json()['photos'][0]['id']==ordered[0]
    settings=client.get('/api/settings').json()
    assert client.put('/api/settings',json=settings|{'count_mode':'file','export_quality':92}).status_code==200
    assert client.get('/api/settings').json()['count_mode']=='file'
    assert client.put('/api/settings',json=settings|{'focal_bands':[100,24,35,60,200]}).status_code==422
    for path in ['/','/watermark/workshop','/watermark/gallery','/watercolor','/timeline','/compare','/faces']:
        assert client.get(path).status_code==200
    assert client.get('/api/health').json()['build_id']
    assert all(p.is_file() for p in paths)
