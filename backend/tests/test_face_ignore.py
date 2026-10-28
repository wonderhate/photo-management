from backend.app.migrations import SCHEMA_VERSION
import hashlib
import json
import sqlite3
from pathlib import Path
import pytest
from sqlalchemy import select,delete
from backend.app.models import (Session,Photo,DetectedFace,FacePerson,FacePrototype,FaceIgnore,
    FaceIgnoredMember,FaceOperation,FaceCover,AlbumPhoto,engine)
from backend.app.services import face_management as management,face_service,face_space
from backend.app import migrations
from test_face_management import setup_people,revision,review
from test_library import import_paths

def token(client,person,ignored=False):
    r=client.get(f'/api/faces/persons/{person}/revision',params={'ignored':ignored});assert r.status_code==200,r.text
    return r.json()['revision']

def decide(client,ids,ignored):
    result=client.post('/api/faces/groups/'+('ignore' if ignored else 'restore'),json={'revisions':{p:token(client,p,not ignored) for p in ids}})
    assert result.status_code==200,result.text
    return result.json()['operation_id']

def test_ignore_restore_preserves_confirmations_covers_albums_and_old_undo(client,image_factory,monkeypatch):
    people,faces,hashes=setup_people(client,image_factory);a,b,c=people
    client.post(f'/api/faces/persons/{a}/confirm')
    album=client.post('/api/albums',json={'name':'Keep old snapshot','person_id':a}).json()
    with Session() as session:
        session.get(DetectedFace,faces[1]).confirmed=False;session.commit()
        relations=[(f.id,f.person_id,f.confirmed,f.encoding,f.location,f.model_space) for f in session.scalars(select(DetectedFace).order_by(DetectedFace.id))]
        prototypes=[(p.person_id,p.model_space,p.encoding) for p in session.scalars(select(FacePrototype).order_by(FacePrototype.person_id,FacePrototype.model_space))]
        members=[(r.photo_id,r.position,r.added_at) for r in session.scalars(select(AlbumPhoto).where(AlbumPhoto.album_id==album['id']))]
    cover=client.patch(f'/api/faces/persons/{a}/cover',json={'face_id':faces[1],'revision':revision(client,a)}).json()['operation_id']
    def fail(*_):raise AssertionError('Ignore/restore must not read models or images')
    monkeypatch.setattr(face_service,'detect_faces',fail);monkeypatch.setattr(face_service,'download_models',fail)
    event=decide(client,[a,b],True)
    assert [p['id'] for p in client.get('/api/faces/persons').json()]==[c]
    assert client.get('/api/faces/ignored').json()['total']==2
    assert review(client)==[] and review(client,a)==[]
    with Session() as session:
        assert [(f.id,f.person_id,f.confirmed,f.encoding,f.location,f.model_space) for f in session.scalars(select(DetectedFace).order_by(DetectedFace.id))]==relations
        assert [(p.person_id,p.model_space,p.encoding) for p in session.scalars(select(FacePrototype).order_by(FacePrototype.person_id,FacePrototype.model_space))]==prototypes
        assert session.get(FaceCover,a).face_id==faces[1]
        assert len(session.scalars(select(FaceIgnoredMember)).all())==3
    assert client.get('/api/albums/'+album['id']).json()['person_id']==a
    assert client.get('/api/albums/'+album['id']).json()['count']==2
    assert client.post('/api/faces/history/'+cover+'/undo').status_code==409
    restored=decide(client,[a,b],False)
    assert {p['id'] for p in client.get('/api/faces/persons').json()}==set(people)
    assert client.get('/api/faces/ignored').json()['total']==0
    # Undo restore, then undo ignore: the old schema-13 digest is usable again.
    assert client.post('/api/faces/history/'+restored+'/undo').status_code==200
    assert client.post('/api/faces/history/'+event+'/undo').status_code==200
    assert client.post('/api/faces/history/'+cover+'/undo').status_code==200
    with Session() as session:
        assert session.scalars(select(FaceIgnore)).all()==[] and session.scalars(select(FaceIgnoredMember)).all()==[]
        assert [(r.photo_id,r.position,r.added_at) for r in session.scalars(select(AlbumPhoto).where(AlbumPhoto.album_id==album['id']))]==members
    assert all(hashlib.sha256(p.read_bytes()).hexdigest()==h for p,h in hashes.items())

def test_rebuild_and_reimport_do_not_revive_same_observation_or_suppress_other_faces(client,image_factory,monkeypatch):
    import struct
    people,faces,hashes=setup_people(client,image_factory);a,b,_=people
    with Session() as session:
        f=session.get(DetectedFace,faces[0]);photo_id=f.photo_id;encoding=f.encoding;bounds=f.location
    event=decide(client,[a],True);manifest=[face_space.contract()];calls=[]
    monkeypatch.setattr(face_service,'active_contract',lambda:manifest[0])
    observation=[{'encoding':encoding.hex(),'location':bounds}]
    monkeypatch.setattr(face_service,'detect_faces',lambda path:calls.append(path) or observation)
    assert face_service.detect_photo(photo_id)['cached'] and calls==[]
    with Session() as session:
        session.execute(delete(DetectedFace).where(DetectedFace.photo_id==photo_id));session.get(Photo,photo_id).face_data={};session.commit()
    # Reordered detections, small numeric jitter, and a genuinely different face in the same source.
    observation[:]=[{'encoding':encoding.hex(),'location':{'left':.01,'top':.01,'right':.09,'bottom':.09}},
        {'encoding':struct.pack('<128f',1,.00001,*([0]*126)).hex(),'location':bounds|{'left':.10001}}]
    face_service.detect_photo(photo_id)
    with Session() as session:
        rows=session.scalars(select(DetectedFace).where(DetectedFace.photo_id==photo_id).order_by(DetectedFace.face_index)).all()
        assert rows[0].person_id!=a and rows[1].person_id==a and rows[1].confirmed
    assert a not in {p['id'] for p in client.get('/api/faces/persons').json()}
    assert not any(f['person_id']==a for f in review(client))
    assert client.post('/api/faces/history/'+event+'/undo').status_code==409
    # Removal is recoverable; rescanning must not revive it or lose face decisions.
    assert client.delete('/api/photos/'+photo_id+'?scope=file').status_code==200
    original=next(p for p in hashes if p.name=='manage-a.jpg');import_paths(client,[original])
    assert client.get('/api/photos',params={'search':original.name}).json()['photos']==[]
    assert client.post('/api/removals/photos/restore',json={'ids':[photo_id]}).status_code==200
    replacement=client.get('/api/photos',params={'search':original.name}).json()['photos'][0]['id'];assert replacement==photo_id
    with Session() as session:
        session.execute(delete(DetectedFace).where(DetectedFace.photo_id==replacement));session.get(Photo,replacement).face_data={};session.commit()
    observation[:]=[{'encoding':encoding.hex(),'location':bounds}];face_service.detect_photo(replacement)
    with Session() as session:assert session.scalar(select(DetectedFace).where(DetectedFace.photo_id==replacement)).person_id==a
    # Different content and different model spaces must not inherit a negative decision.
    path=image_factory('other-content.jpg',color=(177,40,70));import_paths(client,[path]);other=client.get('/api/photos',params={'search':path.name}).json()['photos'][0]['id'];face_service.detect_photo(other)
    with Session() as session:assert session.scalar(select(DetectedFace).where(DetectedFace.photo_id==other)).person_id!=a
    with Session() as session:
        session.execute(delete(DetectedFace).where(DetectedFace.photo_id==replacement));session.get(Photo,replacement).face_data={};session.commit()
    manifest[0]=manifest[0]|{'pipeline':'fixture-new-space'};face_service.detect_photo(replacement)
    with Session() as session:assert session.scalar(select(DetectedFace).where(DetectedFace.photo_id==replacement)).person_id!=a
    count=len(calls);decide(client,[a],False);assert len(calls)==count
    assert all(hashlib.sha256(p.read_bytes()).hexdigest()==h for p,h in hashes.items())

def test_batch_is_atomic_stale_decisions_block_edits_and_ignore_pagination(client,image_factory,monkeypatch):
    people,faces,_=setup_people(client,image_factory);a,b,c=people
    stale=revision(client,a);client.patch('/api/faces/persons/'+a,json={'name':'Noise%_ literal'})
    r=client.post('/api/faces/groups/ignore',json={'revisions':{b:revision(client,b),a:stale}});assert r.status_code==409
    assert client.get('/api/faces/ignored').json()['total']==0
    with monkeypatch.context() as patch:
        patch.setattr(management,'MAX_STATE',1)
        assert client.post('/api/faces/groups/ignore',json={'revisions':{p:token(client,p) for p in (a,b)}}).status_code==400
    assert client.get('/api/faces/ignored').json()['total']==0
    decide(client,[a],True)
    for method,url,data in [('POST',f'/api/faces/persons/{a}/confirm',None),('PATCH',f'/api/faces/persons/{a}',{'name':'Must not rename'}),('DELETE',f'/api/faces/persons/{a}',None),('PATCH','/api/faces/detections/'+faces[0],{'person_id':b}),('PATCH','/api/faces/detections/'+faces[2],{'person_id':a})]:
        assert client.request(method,url,json=data).status_code==409
    assert client.get('/api/faces/ignored?search=%25_').json()['total']==1
    assert client.get('/api/faces/ignored?page=0').status_code==400
    assert client.get('/api/faces/ignored',params={'search':'x'*257}).status_code==400
    assert client.post('/api/faces/groups/ignore',json={'revisions':{}}).status_code==422
    with Session() as session:
        session.add_all(FacePerson(name=f'Noise extra {i:02}') for i in range(41));session.commit()
        more=session.scalars(select(FacePerson).where(FacePerson.name.like('Noise extra%'))).all();tokens={p.id:management.revision(session,p.id) for p in more}
    assert client.post('/api/faces/groups/ignore',json={'revisions':tokens}).status_code==200
    first=client.get('/api/faces/ignored?search=Noise').json();second=client.get('/api/faces/ignored?search=Noise&page=2').json()
    assert first['total']==42 and len(first['people'])==40 and first['has_more'] and len(second['people'])==2 and not second['has_more']
    assert len({p['id'] for p in first['people']+second['people']})==42

def test_schema13_backup_and_copy_preserve_decisions_and_old_history(client,image_factory,tmp_path,monkeypatch):
    from backend.migrate_storage import migrate as copy_library
    people,faces,hashes=setup_people(client,image_factory);a=people[0]
    old=client.patch(f'/api/faces/persons/{a}/cover',json={'face_id':faces[0],'revision':revision(client,a)}).json()['operation_id']
    folder=tmp_path/'v13';folder.mkdir();path=migrations.backup_database(Path(engine.url.database),folder/'library.db')
    with sqlite3.connect(path) as db:
        before=db.execute('SELECT id,person_id,encoding,confirmed,model_space FROM detected_faces ORDER BY id').fetchall()
        history=db.execute('SELECT before_state,after_hash FROM face_operations WHERE id=?',(old,)).fetchone()
        db.execute('DROP TABLE face_ignored_members');db.execute('DROP TABLE face_ignores');db.execute('PRAGMA user_version=13');db.commit()
    with monkeypatch.context() as patch:
        patch.setattr(migrations,'backup_database',lambda *_:(_ for _ in ()).throw(OSError('synthetic ignore backup failure')))
        with pytest.raises(OSError):migrations.migrate_database(path)
    with sqlite3.connect(path) as db:assert db.execute('PRAGMA user_version').fetchone()[0]==13
    assert set(migrations.migrate_database(path))=={'face_ignores','face_ignored_members'} and migrations.migrate_database(path)==[]
    with sqlite3.connect(path) as db:
        assert db.execute('PRAGMA user_version').fetchone()[0]==SCHEMA_VERSION and db.execute('PRAGMA foreign_key_check').fetchall()==[]
        assert db.execute('SELECT id,person_id,encoding,confirmed,model_space FROM detected_faces ORDER BY id').fetchall()==before
        assert db.execute('SELECT before_state,after_hash FROM face_operations WHERE id=?',(old,)).fetchone()==history
    from sqlalchemy import create_engine,event
    from sqlalchemy.orm import sessionmaker
    upgraded=create_engine('sqlite:///'+str(path))
    event.listen(upgraded,'connect',lambda connection,_:connection.execute('PRAGMA foreign_keys=ON'))
    try:
        with monkeypatch.context() as patch:
            patch.setattr(management,'Session',sessionmaker(upgraded,expire_on_commit=False))
            assert management.undo(old)=={'ok':True}
        with sqlite3.connect(path) as db:assert db.execute('SELECT count(*) FROM face_covers').fetchone()[0]==0
    finally:upgraded.dispose()
    decide(client,[a],True);copied=tmp_path/'copy';copy_library(Path(engine.url.database).parent,copied)
    with sqlite3.connect(copied/'library.db') as db:
        assert db.execute('SELECT count(*) FROM face_ignored_members').fetchone()[0]==2 and db.execute('SELECT count(*) FROM face_ignores').fetchone()[0]==1
    assert all(hashlib.sha256(p.read_bytes()).hexdigest()==h for p,h in hashes.items())

def test_library_merge_preserves_target_decisions_and_source_bound_rejections(client,image_factory,tmp_path):
    from backend.library_maintenance import merge_libraries
    import subprocess,sys
    empty=migrations.backup_database(Path(engine.url.database),tmp_path/'empty.db')
    people,faces,_=setup_people(client,image_factory);a=people[0]
    active=migrations.backup_database(Path(engine.url.database),tmp_path/'active.db');decide(client,[a],True)
    ignored=migrations.backup_database(Path(engine.url.database),tmp_path/'ignored.db')
    for target,source,label,expected in [(empty,ignored,'import',1),(active,ignored,'active-wins',0),(ignored,active,'ignored-wins',1)]:
        stage=tmp_path/(label+'.db');merge_libraries(target,source,stage,tmp_path/'absent',tmp_path/'moved')
        with sqlite3.connect(stage) as db:
            assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
            assert db.execute('SELECT count(*) FROM face_ignores').fetchone()[0]==expected
            assert db.execute('SELECT count(*) FROM face_ignored_members').fetchone()[0]==expected*2
    subprocess.run([sys.executable,'-c',"import sys;from pathlib import Path;from backend.library_maintenance import merge_libraries;merge_libraries(*map(Path,sys.argv[1:]));assert 'backend.app.config' not in sys.modules;assert 'backend.app.models' not in sys.modules;assert 'fastapi' not in sys.modules",str(empty),str(ignored),str(tmp_path/'cold.db'),str(tmp_path/'absent'),str(tmp_path/'moved')],check=True,capture_output=True)
    decide(client,[a],False)
    path=image_factory('new-active-member.jpg',color=(180,30,75));before=hashlib.sha256(path.read_bytes()).hexdigest();import_paths(client,[path])
    with Session() as session:
        original=session.get(DetectedFace,faces[0]);photo=session.scalar(select(Photo).where(Photo.file_name==path.name))
        session.add(DetectedFace(photo_id=photo.id,person_id=a,face_index=0,encoding=original.encoding,location=original.location,model_space=original.model_space));session.commit()
    source=migrations.backup_database(Path(engine.url.database),tmp_path/'active-with-new-face.db');stage=tmp_path/'target-remains-ignored.db'
    merge_libraries(ignored,source,stage,tmp_path/'absent',tmp_path/'moved')
    with sqlite3.connect(stage) as db:
        assert db.execute('SELECT count(*) FROM detected_faces WHERE person_id=?',(a,)).fetchone()[0]==3
        assert db.execute('SELECT count(*) FROM face_ignored_members WHERE person_id=?',(a,)).fetchone()[0]==3
        assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
    assert hashlib.sha256(path.read_bytes()).hexdigest()==before
