from backend.app.migrations import SCHEMA_VERSION
import hashlib
import json
import sqlite3
from pathlib import Path
from sqlalchemy import select,event
from backend.app.models import Session,Photo,DetectedFace,FacePerson,CaptureGroup,AlbumPhoto,engine
from backend.app.services import face_service,face_space
from test_library import import_paths
from test_face_ignore import decide

def setup_person(client,image_factory,monkeypatch):
    import struct
    paths=[image_factory('live-one.jpg'),image_factory('live-two.jpg',color=(30,70,110))]
    hashes={p:hashlib.sha256(p.read_bytes()).hexdigest() for p in paths};import_paths(client,paths)
    encoding=struct.pack('<128f',1,*([0]*127));calls=[]
    monkeypatch.setattr(face_service,'active_contract',face_space.contract)
    monkeypatch.setattr(face_service,'detect_faces',lambda path:calls.append(path) or [dict(encoding=encoding.hex(),location={'left':.1,'top':.1,'right':.9,'bottom':.9})])
    ids={p['file_name']:p['id'] for p in client.get('/api/photos').json()['photos']}
    for path in paths:face_service.detect_photo(ids[path.name])
    person=client.get('/api/faces/persons').json()[0]['id'];client.patch('/api/faces/persons/'+person,json={'name':'Live person'});client.post('/api/faces/persons/'+person+'/confirm')
    return person,paths,hashes,calls

def state(client,person,mode='capture',**kw):
    library=client.get('/api/workspace').json()['library_id']
    r=client.get(f'/api/faces/persons/{person}/scope',params={'library_id':library,'count_mode':mode,**kw});assert r.status_code==200,r.text
    return r.json()

def test_new_detections_enter_live_scope_but_never_extend_snapshot(client,image_factory,monkeypatch):
    person,paths,hashes,calls=setup_person(client,image_factory,monkeypatch)
    album=client.post('/api/albums',json={'name':'Saved person snapshot','person_id':person}).json()
    with Session() as session:before=[(m.photo_id,m.position,m.added_at) for m in session.scalars(select(AlbumPhoto).where(AlbumPhoto.album_id==album['id']).order_by(AlbumPhoto.position))]
    old=state(client,person);assert old['total']==old['photo_count']==2 and old['pending']==0
    path=image_factory('live-new.jpg',color=(101,12,17));paths.append(path);hashes[path]=hashlib.sha256(path.read_bytes()).hexdigest();import_paths(client,[path])
    photo=client.get('/api/photos',params={'search':path.name}).json()['photos'][0];face_service.detect_photo(photo['id'])
    live=state(client,person);assert live['total']==3 and live['pending']==1 and live['revision']!=old['revision']
    fixed={'version':1,'library_id':live['library_id'],'mode':'capture','base':{'person_id':person},'origin':'person'}
    assert client.get('/api/photos/ids',params={'scope':json.dumps(fixed)}).json()['ids'] and client.get('/api/photos',params={'scope':json.dumps(fixed),'filename':path.name}).json()['total']==1
    assert client.get('/api/albums/'+album['id']).json()['count']==2
    with Session() as session:assert [(m.photo_id,m.position,m.added_at) for m in session.scalars(select(AlbumPhoto).where(AlbumPhoto.album_id==album['id']).order_by(AlbumPhoto.position))]==before
    # Pair expansion follows the gallery's per-capture/per-file contract.
    raw=path.with_suffix('.RAW');raw.write_bytes(b'synthetic paired original');hashes[raw]=hashlib.sha256(raw.read_bytes()).hexdigest()
    with Session() as session:
        p=session.get(Photo,photo['id']);session.add(Photo(id='person-scope-raw',file_name=raw.name,file_path=str(raw),file_stem=raw.stem,source_directory=str(raw.parent),file_hash=hashes[raw],file_size=raw.stat().st_size,file_format='RAW',is_raw=True,capture_group_id=p.capture_group_id));session.commit()
    capture,files=state(client,person),state(client,person,'file');assert capture['total']==3 and files['total']==4 and files['photo_count']==3
    count=len(calls)
    assert state(client,person)['revision']==capture['revision'] and len(calls)==count
    assert all(hashlib.sha256(p.read_bytes()).hexdigest()==h for p,h in hashes.items())

def test_equal_count_membership_swap_rename_and_preferred_file_change_invalidate(client,image_factory,monkeypatch):
    person,paths,hashes,_=setup_person(client,image_factory,monkeypatch)
    other=client.post('/api/faces/persons',json={'name':'Other person'}).json()['id']
    third=image_factory('live-third.jpg',color=(200,100,21));import_paths(client,[third])
    with Session() as session:
        photo=session.scalar(select(Photo).where(Photo.file_name==third.name));sample=session.scalar(select(DetectedFace).where(DetectedFace.person_id==person));session.add(DetectedFace(id='swap-in',photo_id=photo.id,person_id=other,face_index=0,encoding=sample.encoding,location=sample.location,confirmed=True,model_space=sample.model_space));session.commit()
    old=state(client,person)
    with Session() as session:
        outgoing=session.scalar(select(DetectedFace).where(DetectedFace.person_id==person));outgoing.person_id=other;session.get(DetectedFace,'swap-in').person_id=person;session.commit()
    swapped=state(client,person);assert swapped['total']==old['total']==2 and swapped['pending']==old['pending']==0 and swapped['revision']!=old['revision']
    client.patch('/api/faces/persons/'+person,json={'name':'Renamed live person'});renamed=state(client,person);assert renamed['name']=='Renamed live person' and renamed['revision']!=swapped['revision']
    with Session() as session:
        p=session.get(Photo,photo.id);session.add(Photo(id='new-preferred',file_name='preferred.RAW',file_path=str(third.with_suffix('.RAW')),file_stem='preferred',source_directory=str(third.parent),file_hash='e'*64,file_size=1,file_format='RAW',is_raw=True,capture_group_id=p.capture_group_id));session.flush();session.get(CaptureGroup,p.capture_group_id).preferred_photo_id='new-preferred';session.commit()
    preferred=state(client,person);assert preferred['total']==renamed['total'] and preferred['revision']!=renamed['revision']
    assert all(hashlib.sha256(p.read_bytes()).hexdigest()==h for p,h in hashes.items())

def test_ignored_merged_missing_and_foreign_person_scopes_never_broaden(client,image_factory,monkeypatch):
    person,_,_,_=setup_person(client,image_factory,monkeypatch);other=client.post('/api/faces/persons',json={'name':'Merge target'}).json()['id']
    album=client.post('/api/albums',json={'name':'Historical snapshot','person_id':person}).json()
    revisions={p:client.get(f'/api/faces/persons/{p}/revision').json()['revision'] for p in (person,other)}
    assert client.post('/api/faces/merge',json={'source_ids':[person],'target_id':other,'revisions':revisions}).status_code==200
    source,target=state(client,person),state(client,other);assert source['total']==0 and source['merged_into']=={'id':other,'name':'Merge target'} and target['total']==2
    decide(client,[other],True);ignored=state(client,other);assert ignored['ignored'] and ignored['total']==2 and ignored['revision']!=target['revision']
    assert client.get('/api/albums/'+album['id']).json()['person_id']==person
    assert client.get(f'/api/faces/persons/{other}/scope',params={'library_id':'foreign'}).status_code==400
    assert client.get(f'/api/faces/persons/{other}/scope',params={'library_id':ignored['library_id'],'count_mode':'bad'}).status_code==422
    decide(client,[other],False);client.delete('/api/faces/persons/'+other)
    assert client.get(f'/api/faces/persons/{person}/scope',params={'library_id':ignored['library_id']}).status_code==404
    fixed={'version':1,'library_id':ignored['library_id'],'mode':'capture','base':{'person_id':person},'origin':'person'}
    assert client.get('/api/photos/ids',params={'scope':json.dumps(fixed)}).status_code==400

def test_scope_status_streams_only_small_metadata_without_vectors_or_images(client,image_factory,monkeypatch):
    person,_,hashes,_=setup_person(client,image_factory,monkeypatch)
    with Session() as session:
        face=session.scalar(select(DetectedFace).where(DetectedFace.person_id==person))
        session.add_all(DetectedFace(photo_id=face.photo_id,person_id=person,face_index=i+100,encoding=b'x'*512,location={},model_space=face.model_space) for i in range(2000));session.commit()
        for p in session.scalars(select(Photo)):p.file_path=str(Path('missing-synthetic-source')/p.file_name)
        session.commit()
    statements=[]
    def capture(_conn,_cursor,statement,_parameters,_context,_many):statements.append(statement.lower())
    def fail(*_):raise AssertionError('A read-only scope check must not invoke models')
    monkeypatch.setattr(face_service,'detect_faces',fail);event.listen(engine,'before_cursor_execute',capture)
    try:result=state(client,person)
    finally:event.remove(engine,'before_cursor_execute',capture)
    assert result['pending']==2000 and result['total']==2 and len(json.dumps(result))<1024
    assert not any('encoding' in q or 'file_path' in q or 'location' in q for q in statements)
    assert state(client,person)['revision']==result['revision']
    with sqlite3.connect(engine.url.database) as db:assert db.execute('PRAGMA user_version').fetchone()[0]==SCHEMA_VERSION
    assert all(hashlib.sha256(p.read_bytes()).hexdigest()==h for p,h in hashes.items())
