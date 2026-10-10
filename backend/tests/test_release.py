from test_library import import_paths

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
    for path in ['/','/watermark/workshop','/watermark/gallery','/timeline','/compare','/faces']:
        assert client.get(path).status_code==200
    assert client.get('/api/health').json()['build_id']
    assert all(p.is_file() for p in paths)
