import hashlib
import json
import sqlite3
from pathlib import Path
from urllib.parse import urlencode
import pytest
from sqlalchemy import select,func,event
from backend.app.models import Session,Photo,CaptureGroup,Album,AlbumPhoto
from backend.app.services import library_service,photo_query
from backend.app.migrations import migrate_database,SCHEMA_VERSION

CONTRACT=json.loads((Path(__file__).resolve().parents[2]/'frontend/tests/fixtures/photo-query.json').read_text(encoding='utf-8'))
def query(root):return {'version':1,'root':root}
def seed(original=None):
    with Session() as session:
        for row in CONTRACT['rows']:session.add(CaptureGroup(id=row['id'],preferred_photo_id=row['id']))
        session.flush()
        for index,row in enumerate(CONTRACT['rows']):
            row=row.copy();tags=row.pop('tags');source=original if index==0 and original else Path('/synthetic-query')/row['file_name']
            photo=Photo(**row,file_path=str(source),file_stem=source.stem,source_directory=str(source.parent),file_hash=hashlib.sha256(source.read_bytes() if index==0 and original else row['id'].encode()).hexdigest(),file_format='JPG',file_size=0,capture_group_id=row['id'])
            session.add(photo);session.flush();library_service.set_tags(session,photo,tags)
        session.commit()

def test_shared_boolean_null_date_and_tag_contract_compiles_to_real_sql(client):
    seed()
    for case in CONTRACT['cases']:
        filters={'query':query(case['root'])}
        with Session() as session:assert list(session.scalars(library_service.query_photos(filters).with_only_columns(Photo.id).order_by(Photo.id)))==case['ids'],case['name']
        response=client.post('/api/albums/rules/preview',json=filters);assert response.status_code==200,response.text
        assert response.json()['total']==len(case['ids'])
        assert set(p['id'] for p in response.json()['candidates'])==set(case['ids'])
        qs=urlencode({'query':json.dumps(filters['query'])})
        assert set(client.get('/api/photos/ids?'+qs).json()['ids'])==set(case['ids'])

def test_rule_membership_is_live_counted_filtered_paged_and_not_a_snapshot(client,image_factory,monkeypatch):
    source=image_factory('query-original.jpg');before=hashlib.sha256(source.read_bytes()).hexdigest();seed(source)
    rule=query({'op':'or','children':[{'op':'is_null','field':'rating'},{'op':'eq','field':'rating','value':0}]})
    response=client.post('/api/albums',json={'name':'Unrated or zero','type':'rule','query':rule});assert response.status_code==200,response.text
    album=response.json();assert album['count']==3 and album['query']==rule
    with Session() as session:assert session.scalar(select(func.count()).select_from(AlbumPhoto).where(AlbumPhoto.album_id==album['id']))==0
    base='/api/photos?'+urlencode({'album_id':album['id'],'page_size':1,'sort':'file_name'})
    rows=[client.get(base+'&page='+str(page)).json() for page in (1,2,3)]
    assert all(r['total']==3 for r in rows) and len({r['photos'][0]['id'] for r in rows})==3
    assert client.get('/api/stats?album_id='+album['id']).json()['summary']['total']==3
    assert set(client.get('/api/photos/ids?album_id='+album['id']+'&sort=manual').json()['ids'])=={'a','b','f'}
    assert client.patch('/api/photos/a',json={'rating':5}).status_code==200
    assert client.get('/api/albums/'+album['id']).json()['count']==2
    assert client.patch('/api/photos/c',json={'rating':None}).status_code==200
    assert client.get('/api/albums/'+album['id']).json()['count']==3
    assert client.get('/api/photos?album_id='+album['id']+'&camera=SONY').json()['total']==2
    from backend.app.services.embedding_service import service
    monkeypatch.setattr(service,'search',lambda *args:[{'photo_id':'b'}])
    assert client.get('/api/photos?album_id='+album['id']+'&semantic=sea').json()['total']==1
    assert client.put('/api/albums/'+album['id']+'/order',json={'photo_ids':['a']}).status_code==400
    assert client.put('/api/albums/'+album['id']+'/photos',json={'name':'rule','photo_ids':['a']}).status_code==400
    updated=client.patch('/api/albums/'+album['id'],json={'name':'Zero only','query':query({'op':'eq','field':'rating','value':0})})
    assert updated.json()['count']==1 and updated.json()['name']=='Zero only'
    assert client.delete('/api/albums/'+album['id']).status_code==200
    colors=query({'op':'is_null','field':'color_label'})
    def missing_colors():return client.post('/api/albums/rules/preview',json={'query':colors}).json()['total']
    assert missing_colors()==6
    client.patch('/api/photos/a',json={'color_label':'red'});assert missing_colors()==5
    assert client.patch('/api/photos/a',json={'color_label':'none'}).json()['color_label'] is None
    client.post('/api/photos/batch-edit',json={'photo_ids':['b'],'color_label':'blue'});assert missing_colors()==5
    client.post('/api/photos/batch-edit',json={'photo_ids':['b'],'color_label':'none'});assert missing_colors()==6
    assert client.get('/api/photos').json()['total']==6 and hashlib.sha256(source.read_bytes()).hexdigest()==before

def test_rule_deep_pages_count_and_ids_use_sql_without_hydrating_the_library(client):
    rows=[dict(id=f'live-{i:04d}',file_name=f'Live-{i:04d}.jpg',rating=[None,0,1,2,3,4,5][i%7]) for i in range(1027)]
    with Session() as session:
        for row in rows:session.add(CaptureGroup(id=row['id'],preferred_photo_id=row['id']))
        session.flush()
        for row in rows:session.add(Photo(**row,file_path='/synthetic-query/'+row['id'],file_stem=row['id'],source_directory='/synthetic-query',file_hash=hashlib.sha256(row['id'].encode()).hexdigest(),file_format='JPG',file_size=0,capture_group_id=row['id'],raw_exif={'large':'x'*4096}))
        session.commit()
    rule=query({'op':'or','children':[{'op':'is_null','field':'rating'},{'op':'eq','field':'rating','value':0}]})
    album=client.post('/api/albums',json={'name':'Live large','type':'rule','query':rule}).json()
    expected=[r['id'] for r in rows if r['rating'] in (None,0)];assert album['count']==len(expected)
    loaded=[]
    def record(photo,context):loaded.append(photo.id)
    event.listen(Photo,'load',record)
    try:
        ids=client.get('/api/photos/ids?album_id='+album['id']+'&sort=file_name&direction=asc').json()['ids'];assert ids==expected and loaded==[]
        page=client.get('/api/photos?album_id='+album['id']+'&sort=file_name&direction=asc&page_size=23&page=10').json()
        assert page['total']==len(expected) and [p['id'] for p in page['photos']]==expected[207:230] and len(loaded)<=46
    finally:event.remove(Photo,'load',record)
    pages=[]
    for index in range(1,(len(expected)+22)//23+1):pages.extend(p['id'] for p in client.get(f'/api/photos?album_id={album["id"]}&sort=file_name&direction=asc&page_size=23&page={index}').json()['photos'])
    assert pages==expected and len(set(pages))==len(expected)

def test_semantic_and_manual_albums_are_not_converted_to_metadata_queries(client,monkeypatch):
    seed();semantic={'name':'semantic','type':'smart','keywords':['海边'],'photo_ids':['c','d'],'scores':{'c':.9,'d':.8}}
    album=client.post('/api/albums',json=semantic).json();assert album['type']=='smart' and album['count']==2 and album['query'] is None
    rule=query({'op':'eq','field':'rating','value':0})
    assert client.patch('/api/albums/'+album['id'],json={'query':rule}).status_code==400
    assert client.patch('/api/photos/c',json={'rating':0}).status_code==200
    assert client.get('/api/albums/'+album['id']).json()['count']==2
    assert set(client.get('/api/photos/ids?album_id='+album['id']).json()['ids'])=={'c','d'}
    from backend.app.main import ai
    monkeypatch.setattr(ai,'search',lambda *args:[{'photo_id':'b','similarity_score':.75}])
    proposal=client.post('/api/albums/'+album['id']+'/rerun').json()
    assert [r['id'] for r in proposal['candidates']]==['c','d','b']
    assert proposal['selected_photo_ids']==['c','d']
    assert client.get('/api/albums/'+album['id']).json()['count']==2
    with Session() as session:assert session.get(Album,album['id']).keywords==['海边']

def test_query_bounds_and_bad_updates_do_not_modify_an_album(client):
    seed();good=query({'op':'eq','field':'rating','value':0});album=client.post('/api/albums',json={'type':'rule','name':'zero','query':good}).json()
    bad=[None,{'version':2,'root':good['root']},query({'op':'eq','field':'rating','value':True}),query({'op':'eq','field':'rating','value':6}),query({'op':'eq','field':'date_taken','value':'2026-02-30'}),query({'op':'eq','field':'file_name','value':'x'*257}),query({'op':'or','children':[]}),query({'op':'is_null','field':'rating','value':0}),query({'op':'eq','field':'raw_exif','value':'x'})]
    deep=good['root']
    for _ in range(9):deep={'op':'not','child':deep}
    bad.append(query(deep))
    for value in bad:
        assert client.post('/api/albums/rules/preview',json={'query':value}).status_code in (400,422)
        assert client.patch('/api/albums/'+album['id'],json={'name':'do not change','query':value}).status_code in (400,422)
        assert client.get('/api/albums/'+album['id']).json()['query']==good
        assert client.get('/api/albums/'+album['id']).json()['name']=='zero'
    assert client.get('/api/photos?query=%7Bbad').status_code==400
    assert client.post('/api/albums',json={'name':'wrong','type':'rule','query':good,'photo_ids':['a']}).status_code==422

def test_schema4_upgrade_keeps_semantic_rows_and_exact_backup_and_rolls_back_on_backup_error(tmp_path,monkeypatch):
    import backend.app.migrations as migrations
    path=tmp_path/'old.db'
    with sqlite3.connect(path) as db:
        db.execute('CREATE TABLE photos(id TEXT PRIMARY KEY)')
        db.execute('CREATE TABLE albums(id TEXT PRIMARY KEY,type TEXT,keywords JSON,cover_photo_id TEXT,person_id TEXT)')
        db.execute('INSERT INTO albums VALUES (?,?,?,?,?)',('semantic','smart','["sea"]',None,None))
    migrate_database(path,backup=False)
    with sqlite3.connect(path) as db:
        db.execute('ALTER TABLE albums DROP COLUMN query');db.execute('PRAGMA user_version=4')
    old=path.read_bytes();assert migrate_database(path)==['albums.query']
    backup=next((tmp_path/'backups').glob('*.db'))
    with sqlite3.connect(backup) as db:
        assert db.execute('PRAGMA user_version').fetchone()[0]==4
        assert 'query' not in {r[1] for r in db.execute('PRAGMA table_info(albums)')}
    with sqlite3.connect(path) as db:
        assert db.execute('SELECT type,keywords,query FROM albums').fetchone()==('smart','["sea"]',None)
        assert db.execute('PRAGMA user_version').fetchone()[0]==SCHEMA_VERSION==28
    assert migrate_database(path)==[]
    failed=tmp_path/'failed.db';failed.write_bytes(old)
    def denied(*args,**kwargs):raise OSError('synthetic backup failure')
    monkeypatch.setattr(migrations,'backup_database',denied)
    with pytest.raises(OSError):migrate_database(failed)
    assert failed.read_bytes()==old
