"""Stable SQL/ID-only ordering; fixtures never open or change personal photos."""
import hashlib
import json
from pathlib import Path
from sqlalchemy import event
from backend.app.config import DATA
from backend.app.models import Session, Photo, CaptureGroup

CONTRACT = json.loads((Path(__file__).resolve().parents[2]/'frontend/tests/fixtures/photo-order.json').read_text(encoding='utf-8'))


def seed(rows, original=None):
    with Session() as session:
        for row in rows:session.add(CaptureGroup(id='group-'+row['id'],preferred_photo_id=row['id']))
        session.flush()
        for i,row in enumerate(rows):
            path=original if i==0 and original else DATA/'sort-fixtures'/(row['id']+'.jpg')
            digest=hashlib.sha256(path.read_bytes() if i==0 and original else row['id'].encode()).hexdigest()
            session.add(Photo(**row,file_path=str(path),file_stem=Path(row['file_name']).stem,
                source_directory=str(path.parent),file_hash=digest,file_format='JPG',file_size=0,
                capture_group_id='group-'+row['id'],raw_exif={'synthetic':'x'*4096}))
        session.commit()


def test_sql_and_id_endpoint_match_the_shared_order_contract(client):
    seed(CONTRACT['rows'])
    for key,expected in CONTRACT['expected'].items():
        field,direction=key.split(':');query=f'sort={field}&direction={direction}'
        assert client.get('/api/photos/ids?'+query).json()['ids']==expected
        assert [p['id'] for p in client.get('/api/photos?'+query).json()['photos']]==expected
    assert client.get('/api/photos/ids?sort=__proto__&direction=invalid').json()['ids']==CONTRACT['expected']['date_taken:desc']


def test_tied_pages_and_deep_offset_only_hydrate_the_requested_window(client,image_factory):
    original=image_factory('sort-original.jpg');before=hashlib.sha256(original.read_bytes()).hexdigest()
    rows=[dict(id=f'sort-{i:04d}',file_name='Same.jpg',rating=[None,0,1,2,3,4,5][i%7],
        date_taken=None if i%4==0 else '2026-01-01T12:00:00',created_at='2026-02-01T12:00:00') for i in reversed(range(1027))]
    seed(rows,original)
    for direction in ('asc','desc'):
        ids=client.get('/api/photos/ids?sort=rating&direction='+direction).json()['ids'];pages=[]
        for page in range(1,16):
            response=client.get(f'/api/photos?sort=rating&direction={direction}&page={page}&page_size=73').json()
            assert response['total']==1027;pages.extend(p['id'] for p in response['photos'])
        assert pages==ids and len(set(pages))==1027
        expected=sorted(rows,key=lambda r:(r['rating'] is None,(-1 if direction=='desc' else 1)*(r['rating'] or 0),r['id']))
        assert ids==[r['id'] for r in expected]
    loaded=[]
    def record(photo,context):loaded.append(photo.id)
    event.listen(Photo,'load',record)
    try:
        ids=client.get('/api/photos/ids?sort=rating').json()['ids'];assert loaded==[]
        response=client.get('/api/photos?sort=rating&page=14&page_size=73').json()
        assert [p['id'] for p in response['photos']]==ids[949:1022]
        assert len(loaded)<=146 and all('raw_exif' not in p for p in response['photos'])
        requested=ids[80:110][::-1]
        assert [p['id'] for p in client.post('/api/photos/by-ids',json={'ids':requested}).json()['photos']]==requested
    finally:event.remove(Photo,'load',record)
    assert hashlib.sha256(original.read_bytes()).hexdigest()==before


def test_rating_order_does_not_change_album_manual_positions(client):
    seed(CONTRACT['rows']);order=['f','z','a','g','e']
    album=client.post('/api/albums',json={'name':'manual order','photo_ids':order}).json()
    assert client.put(f'/api/albums/{album["id"]}/order',json={'photo_ids':order}).status_code==200
    for direction in ('asc','desc'):
        assert client.get(f'/api/photos/ids?album_id={album["id"]}&sort=manual&direction={direction}').json()['ids']==order
        rated=client.get(f'/api/photos/ids?album_id={album["id"]}&sort=rating&direction={direction}').json()['ids']
        assert rated==[i for i in CONTRACT['expected']['rating:'+direction] if i in order]
    assert client.get(f'/api/photos/ids?album_id={album["id"]}&sort=manual').json()['ids']==order


def test_rating_preferences_remain_bound_to_the_library(client):
    identity=client.get('/api/workspace').json()['library_id']
    payload={'library_id':identity,'values':{'sort':'rating','direction':'asc'}}
    assert client.patch('/api/workspace/preferences',json=payload).json()==payload['values']
    assert client.patch('/api/workspace/preferences',json=payload|{'library_id':'other-library','values':{'sort':'file_name'}}).status_code==409
    assert client.get('/api/workspace').json()['preferences']==payload['values']
