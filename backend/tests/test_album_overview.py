import hashlib
import sqlite3
import pytest
from sqlalchemy import select,event
from backend.app.models import Session,Photo,Album,AlbumPhoto,LibraryProfile,FacePerson,DetectedFace,engine
from backend.app.config import DATA
from backend.app.services import album_service
from backend.app.migrations import backup_database,migrate_database,SCHEMA_VERSION,ADDITIONS
from test_photo_query import seed
from test_library import import_paths

def test_overview_batches_captures_without_loading_exif_and_manual_cover_wins(client):
    seed()
    with Session() as s:
        # A second file for the same capture must not inflate summaries or cover tiles.
        original=s.get(Photo,'a');raw=Photo(**{c.name:getattr(original,c.name) for c in Photo.__table__.columns if c.name not in ('id','file_path','file_hash','is_raw')},id='a-raw',file_path='/synthetic-query/a.raw',file_hash='f'*64,is_raw=True)
        s.add(raw)
        for i in range(30):
            a=Album(id=f'overview-{i}',name=f'Album {i}',cover_photo_id='f' if i==0 else None);s.add(a);s.flush()
            for pos,pid in enumerate(['a-raw','a','b','c','d','e','f']):s.add(AlbumPhoto(album_id=a.id,photo_id=pid,position=pos))
        s.commit()
    queries=[];loaded=[]
    def statement(conn,cursor,sql,parameters,context,many):queries.append(sql)
    def load(photo,context):loaded.append(photo.id)
    event.listen(engine,'before_cursor_execute',statement);event.listen(Photo,'load',load)
    try:rows=client.get('/api/albums').json()
    finally:event.remove(engine,'before_cursor_execute',statement);event.remove(Photo,'load',load)
    assert loaded==[] and len(queries)<=5
    assert all(a['count']==6 for a in rows)
    a=next(a for a in rows if a['id']=='overview-1');assert a['cover_ids']==['a','b','c','d'] and a['cover_mode']=='auto'
    photos=client.get('/api/photos').json()['photos'];dates=sorted(p['date_taken'] for p in photos if p['date_taken'])
    assert (a['date_from'],a['date_to'],a['unknown_date_count'])==(dates[0],dates[-1],6-len(dates))
    manual=next(a for a in rows if a['id']=='overview-0');assert manual['cover_ids']==['f'] and manual['cover_mode']=='manual'
    client.delete('/api/photos/f?scope=file');missing=client.get('/api/albums/overview-0').json()
    assert missing['cover_ids']==[] and missing['cover_missing'] and missing['cover_mode']=='manual'
    reset=client.patch('/api/albums/overview-0',json={'cover_photo_id':''}).json();assert len(reset['cover_ids'])==4 and not reset['cover_missing']

def test_recent_pages_preserve_known_and_unknown_history_scores_and_original(client,image_factory):
    source=image_factory('overview-original.jpg');before=hashlib.sha256(source.read_bytes()).hexdigest();seed(source)
    a=client.post('/api/albums',json={'name':'Recent','photo_ids':['a','b','c'],'scores':{'a':.8}}).json();aid=a['id']
    with Session() as s:
        for m in s.scalars(select(AlbumPhoto).where(AlbumPhoto.album_id==aid)):
            m.added_at=None if m.photo_id=='a' else '2026-01-01T00:00:00+00:00';m.position=3 if m.photo_id=='a' else 7
        s.commit()
    r=client.put(f'/api/albums/{aid}/photos',json={'name':'Recent','photo_ids':['a','b','d']});assert r.status_code==200,r.text
    with Session() as s:
        rows={m.photo_id:m for m in s.scalars(select(AlbumPhoto).where(AlbumPhoto.album_id==aid))}
        assert rows['a'].added_at is None and rows['a'].position==3 and rows['a'].similarity_score==.8
        assert rows['b'].added_at=='2026-01-01T00:00:00+00:00' and rows['d'].added_at and 'c' not in rows
        stamp=rows['d'].added_at
    client.put(f'/api/albums/{aid}/order',json={'photo_ids':['a','d','b']})
    loaded=[]
    def load(photo,context):loaded.append(photo.id)
    event.listen(Photo,'load',load)
    try:first_page=client.get(f'/api/albums/{aid}/recent?page_size=1').json()
    finally:event.remove(Photo,'load',load)
    assert loaded==['d']
    pages=[first_page]+[client.get(f'/api/albums/{aid}/recent?page_size=1&page={i}').json() for i in range(2,4)]
    assert [r['photos'][0]['id'] for r in pages]==['d','b','a'] and all(r['total']==3 for r in pages)
    assert pages[0]['photos'][0]['album_added_at']==stamp and pages[2]['photos'][0]['album_added_at'] is None
    assert client.get(f'/api/albums/{aid}/recent?page_size=101').status_code==400
    rule=client.post('/api/albums',json={'name':'Live','type':'rule','query':{'version':1,'root':{'op':'is_null','field':'rating'}}}).json()
    assert rule['last_added_at'] is None and rule['last_imported_at'] and rule['recent_kind']=='imported'
    recent=client.get('/api/albums/'+rule['id']+'/recent?page_size=1').json()
    assert recent['recent_kind']=='imported' and recent['photos'][0]['album_added_at'] is None
    assert hashlib.sha256(source.read_bytes()).hexdigest()==before

def test_bulk_delete_is_atomic_relations_only_and_preserves_person_draft_and_source(client,image_factory):
    source=image_factory('bulk-original.jpg');before=hashlib.sha256(source.read_bytes()).hexdigest();import_paths(client,[source]);p=client.get('/api/photos').json()['photos'][0]
    with Session() as s:
        person=FacePerson(name='Synthetic');s.add(person);s.flush();s.add(DetectedFace(photo_id=p['id'],person_id=person.id,face_index=0,encoding=b'synthetic',location={},confirmed=True));s.commit();person_id=person.id
    draft=client.post('/api/watermark/drafts',json={'photo_id':p['id'],'name':'Kept','settings_json':{}});assert draft.status_code==201
    albums=[client.post('/api/albums',json=payload).json() for payload in [{'name':'Person','person_id':person_id},{'name':'Manual','photo_ids':[p['id']]},{'name':'Keep'}]]
    ids=[a['id'] for a in albums];state=client.get('/api/workspace').json();client.patch('/api/workspace/albums',json={'library_id':state['library_id'],'values':{'view':'table','order':ids}})
    assert client.post('/api/albums/batch-delete',json={'ids':[ids[0],'missing']}).status_code==400
    assert len(client.get('/api/albums').json())==3
    for invalid in [[],[ids[0],ids[0]],['../unsafe'],[str(i) for i in range(1001)]]:assert client.post('/api/albums/batch-delete',json={'ids':invalid}).status_code==422
    result=client.post('/api/albums/batch-delete',json={'ids':ids[:2]});assert result.json()=={'deleted':2,'originals_untouched':True}
    assert client.get('/api/workspace').json()['album_preferences']=={'view':'table','order':[ids[2]]}
    with Session() as s:assert s.get(FacePerson,person_id) is not None and s.scalar(select(DetectedFace.id)) is not None and not list(s.scalars(select(AlbumPhoto)))
    assert client.get('/api/photos').json()['total']==1 and client.get('/api/watermark/drafts/'+draft.json()['id']).status_code==200
    assert hashlib.sha256(source.read_bytes()).hexdigest()==before

def test_schema_five_join_history_upgrade_backs_up_and_rolls_back_without_fabricating_dates(client,tmp_path,monkeypatch):
    seed();a=client.post('/api/albums',json={'name':'Legacy','photo_ids':['a']}).json()
    path=backup_database(DATA/'library.db',tmp_path/'legacy.db')
    with sqlite3.connect(path) as db:db.execute('ALTER TABLE album_photos DROP COLUMN added_at');db.execute('PRAGMA user_version=5')
    before=path.read_bytes()
    with monkeypatch.context() as patch:
        patch.setitem(ADDITIONS['album_photos'],'added_at','VARCHAR DEFAULT (')
        with pytest.raises(sqlite3.OperationalError):migrate_database(path)
    assert path.read_bytes()==before
    assert migrate_database(path)==['album_photos.added_at'];assert migrate_database(path)==[]
    with sqlite3.connect(path) as db:
        assert db.execute('PRAGMA user_version').fetchone()[0]==SCHEMA_VERSION==28
        assert db.execute('SELECT added_at FROM album_photos WHERE album_id=?',(a['id'],)).fetchone()[0] is None
    for backup in (tmp_path/'backups').glob('*.db'):
        with sqlite3.connect(backup) as db:assert db.execute('PRAGMA user_version').fetchone()[0]==5 and 'added_at' not in [r[1] for r in db.execute('PRAGMA table_info(album_photos)')]
