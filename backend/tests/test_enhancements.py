from test_library import import_paths


def test_batch_tags_idempotent_and_validation(client,image_factory):
    import_paths(client,[image_factory()])
    photo=client.get('/api/photos').json()['photos'][0]
    payload={'photo_ids':[photo['id']],'add_tags':['旅行','旅行','  日落  '],'rating':5,'color_label':'green'}
    for _ in range(2):
        assert client.post('/api/photos/batch-edit',json=payload).status_code==200
    detail=client.get('/api/photos/'+photo['id']).json()
    assert set(detail['tags'])=={'旅行','日落'} and detail['rating']==5
    assert client.post('/api/photos/batch-edit',json={'photo_ids':[photo['id']],'remove_tags':['旅行']}).status_code==200
    assert client.patch('/api/photos/'+photo['id'],json={'rating':None,'color_label':'none'}).json()['rating'] is None
    assert client.post('/api/photos/batch-edit',json=payload|{'rating':6}).status_code==422
    assert client.post('/api/photos/batch-edit',json=payload|{'color_label':'bad'}).status_code==422


def test_timeline_capture_dedup_heatmap_pagination(client,image_factory,tmp_path):
    jpg=image_factory();raw=tmp_path/(jpg.stem+'.ARW');raw.write_bytes(b'raw metadata only')
    import_paths(client,[jpg,raw])
    assert client.get('/api/timeline').json()['years']['2026']['total']==1
    assert client.get('/api/timeline?count_mode=file').json()['years']['2026']['total']==2
    assert client.get('/api/timeline/heatmap/2026').json()=={'2026-09-29':1}
    assert client.get('/api/timeline/2026/9/29?page_size=1').json()['total']==1
    assert len(client.get('/api/timeline/2026?count_mode=file&page_size=1&page=2').json()['photos'])==1
    assert client.get('/api/timeline/2026/13').status_code==400
    assert client.get('/api/timeline/2026?page_size=1000').status_code==400
