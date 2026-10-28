from backend.app.migrations import SCHEMA_VERSION
import hashlib
import json
import sqlite3
from pathlib import Path
import pytest
from sqlalchemy import select
from backend.app.models import (Session,Photo,DetectedFace,FacePerson,FaceCover,FaceMerge,
    FacePrototype,FaceOperation,LibraryProfile,Album,AlbumPhoto,engine)
from backend.app.services import face_space,face_management as management
from test_library import import_paths

def setup_people(client,image_factory):
    paths=[image_factory('manage-a.jpg'),image_factory('manage-b.jpg',color=(1,20,40)),image_factory('manage-c.jpg',color=(90,20,1))]
    hashes={p:hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
    import_paths(client,paths)
    people=[client.post('/api/faces/persons',json={'name':name}).json()['id'] for name in ['Alpha','Beta','Gamma']]
    import struct
    vector=struct.pack('<128f',1,*([0]*127))
    with Session() as session:
        photos=session.scalars(select(Photo).order_by(Photo.file_name)).all()
        a=face_space.contract();b=a|{'pipeline':a['pipeline']+'-fixture-other'}
        spaces=[face_space.register(session,m) for m in (a,b)]
        faces=[]
        for index,photo in enumerate(photos):
            person=session.get(FacePerson,people[0 if index<2 else 1]);space=spaces[index%2]
            face_space.prototype(session,person,space,vector)
            f=DetectedFace(photo_id=photo.id,person_id=person.id,face_index=0,encoding=vector,location={'left':.1,'top':.1,'right':.9,'bottom':.9},confirmed=index!=1,model_space=space)
            session.add(f);session.flush();faces.append(f.id)
        session.commit()
    return people,faces,hashes

def revision(client,person):
    result=client.get(f'/api/faces/persons/{person}/revision');assert result.status_code==200,result.text
    return result.json()['revision']

def review(client,person=None):
    return client.get('/api/faces/review',params={'person_id':person} if person else {}).json()['faces']

def undo(client,result):
    assert result.status_code==200,result.text
    response=client.post('/api/faces/history/'+result.json()['operation_id']+'/undo');assert response.status_code==200,response.text

def test_cover_merge_nested_undo_keeps_every_snapshot_and_original(client,image_factory):
    people,faces,hashes=setup_people(client,image_factory);a,b,c=people
    assert client.post(f'/api/faces/persons/{a}/confirm').status_code==200
    albums=[client.post('/api/albums',json={'name':'Snapshot '+p,'person_id':p}).json() for p in (a,b)]
    with Session() as session:
        members=[(m.album_id,m.photo_id,m.position,m.added_at) for m in session.scalars(select(AlbumPhoto).order_by(AlbumPhoto.album_id,AlbumPhoto.position))]
        prototypes={(p.person_id,p.model_space):p.encoding for p in session.scalars(select(FacePrototype))}
    cover=client.patch(f'/api/faces/persons/{a}/cover',json={'face_id':faces[1],'revision':revision(client,a)})
    assert cover.status_code==200,cover.text
    assert next(p for p in client.get('/api/faces/persons').json() if p['id']==a)['cover_face_id']==faces[1]
    merge=client.post('/api/faces/merge',json={'source_ids':[a],'target_id':b,'revisions':{p:revision(client,p) for p in (a,b)}})
    assert merge.status_code==200,merge.text
    visible=client.get('/api/faces/persons').json();assert {p['id'] for p in visible}=={b,c}
    target=next(p for p in visible if p['id']==b)
    assert target['photo_count']==3 and len(target['albums'])==2
    historical=next(x for x in target['albums'] if x.get('historical'));assert historical['id']==albums[0]['id'] and historical['source_person_id']==a and historical['linked'] is False
    assert client.patch('/api/faces/detections/'+faces[2],json={'person_id':a}).status_code==409
    assert client.post(f'/api/faces/persons/{a}/confirm').status_code==409
    nested=client.post('/api/faces/merge',json={'source_ids':[b],'target_id':c,'revisions':{p:revision(client,p) for p in (b,c)}})
    assert nested.status_code==200,nested.text
    assert len(client.get('/api/faces/persons').json())==1
    # Undo is guarded: first undo the dependent edit, then its predecessor.
    assert client.post('/api/faces/history/'+merge.json()['operation_id']+'/undo').status_code==409
    undo(client,nested);undo(client,merge);undo(client,cover)
    with Session() as session:
        assert session.scalars(select(FaceMerge)).all()==[] and session.scalars(select(FaceCover)).all()==[]
        assert {(p.person_id,p.model_space):p.encoding for p in session.scalars(select(FacePrototype))}==prototypes
        assert [(m.album_id,m.photo_id,m.position,m.added_at) for m in session.scalars(select(AlbumPhoto).order_by(AlbumPhoto.album_id,AlbumPhoto.position))]==members
        assert [session.get(Album,x['id']).person_id for x in albums]==[a,b]
    assert all(hashlib.sha256(p.read_bytes()).hexdigest()==h for p,h in hashes.items())
    history=client.get('/api/faces/history').json();assert len(history['items'])==3 and all(x['undone'] for x in history['items'])
    assert all(set(x)=={'id','kind','created_at','undone'} for x in history['items'])

def test_split_unlink_assign_and_persisted_history_guard(client,image_factory):
    people,faces,hashes=setup_people(client,image_factory);a,b,_=people
    old=review(client,a);chosen=next(f for f in old if f['id']==faces[1])
    cover=client.patch(f'/api/faces/persons/{a}/cover',json={'face_id':chosen['id'],'revision':revision(client,a)})
    split=client.post('/api/faces/split',json={'name':'Separated','face_versions':{chosen['id']:chosen['version']}})
    assert split.status_code==200,split.text
    new=split.json()['person_id'];assert new not in people
    assert client.get('/api/faces/persons/'+new+'/photos').json()['total']==1
    with Session() as session:assert session.get(FaceCover,a) is None
    # History survives fresh sessions. Album links created later prevent deleting the new person during undo.
    album=client.post('/api/albums',json={'name':'New snapshot','person_id':new}).json()
    assert client.post('/api/faces/history/'+split.json()['operation_id']+'/undo').status_code==409
    assert client.delete('/api/albums/'+album['id']).status_code==200
    undo(client,split)
    assert client.get('/api/faces/persons/'+new+'/photos').status_code==404
    with Session() as session:assert session.get(FaceCover,a).face_id==chosen['id'] and not session.get(DetectedFace,chosen['id']).confirmed
    current=next(f for f in review(client,a) if f['id']==chosen['id'])
    unlinked=client.post('/api/faces/unlink',json={'face_versions':{current['id']:current['version']}})
    assert unlinked.status_code==200,unlinked.text
    assert any(f['id']==current['id'] and f['person_id'] is None for f in review(client))
    assert client.post('/api/faces/split',json={'name':'Stale','face_versions':{current['id']:current['version']}}).status_code==409
    undo(client,unlinked)
    moved=client.patch('/api/faces/detections/'+current['id'],json={'person_id':b,'version':current['version']})
    assert moved.status_code==200,moved.text
    undo(client,moved);undo(client,cover)
    assert all(hashlib.sha256(p.read_bytes()).hexdigest()==h for p,h in hashes.items())

def test_stale_tokens_delete_changed_observation_and_rollback(client,image_factory,monkeypatch):
    people,faces,_=setup_people(client,image_factory);a,b,_=people
    old_revision=revision(client,a)
    current=review(client,a)[0]
    event=client.post('/api/faces/unlink',json={'face_versions':{current['id']:current['version']}})
    assert event.status_code==200,event.text
    assert client.patch(f'/api/faces/persons/{a}/cover',json={'face_id':faces[1],'revision':old_revision}).status_code==409
    assert client.post('/api/faces/merge',json={'source_ids':[a],'target_id':b,'revisions':{a:old_revision,b:revision(client,b)}}).status_code==409
    with Session() as session:
        face=session.get(DetectedFace,current['id']);face.location={'left':.2,'top':.2,'right':.9,'bottom':.9};session.commit()
    assert client.post('/api/faces/history/'+event.json()['operation_id']+'/undo').status_code==409
    # Atomic rollback also restores the removed cover and every per-space reference.
    old_state=management.canonical(None)
    with Session() as session:scope=management.context(session,[a,b]);old_state=management.snapshot(session,scope)
    monkeypatch.setattr(management,'MAX_STATE',1)
    face=review(client,a)[0]
    assert client.post('/api/faces/split',json={'name':'Must roll back','face_versions':{face['id']:face['version']}}).status_code==400
    with Session() as session:assert management.snapshot(session,scope)==old_state and session.scalar(select(FacePerson.id).where(FacePerson.name=='Must roll back')) is None

def test_delete_merged_cluster_never_resurrects_alias_or_deletes_album(client,image_factory):
    people,faces,hashes=setup_people(client,image_factory);a,b,c=people
    client.post(f'/api/faces/persons/{a}/confirm')
    album=client.post('/api/albums',json={'name':'Keep snapshot','person_id':a}).json()
    merged=client.post('/api/faces/merge',json={'source_ids':[a],'target_id':b,'revisions':{p:revision(client,p) for p in (a,b)}})
    assert merged.status_code==200,merged.text
    assert client.delete('/api/faces/persons/'+b).status_code==200
    assert [p['id'] for p in client.get('/api/faces/persons').json()]==[c]
    assert client.get('/api/albums/'+album['id']).json()['count']==2
    assert client.get('/api/albums/'+album['id']).json()['person_id'] is None
    assert client.post('/api/faces/history/'+merged.json()['operation_id']+'/undo').status_code==409
    assert all(hashlib.sha256(p.read_bytes()).hexdigest()==h for p,h in hashes.items())

def test_bad_legacy_cover_and_scope_validation(client,image_factory):
    people,faces,hashes=setup_people(client,image_factory);a,b,_=people
    assert client.patch(f'/api/faces/persons/{a}/cover',json={'face_id':faces[2],'revision':revision(client,a)}).status_code==400
    assert client.post('/api/faces/merge',json={'source_ids':[a],'target_id':a,'revisions':{a:revision(client,a)}}).status_code==400
    current=review(client,a)[0]
    assert client.post('/api/faces/split',json={'name':'  ','face_versions':{current['id']:current['version']}}).status_code==400
    assert client.post('/api/faces/unlink',json={'face_versions':{}}).status_code==422
    with Session() as session:
        for face in session.scalars(select(DetectedFace).where(DetectedFace.person_id==a)):face.location={}
        session.commit()
    assert next(p for p in client.get('/api/faces/persons').json() if p['id']==a)['cover_url'] is None
    assert client.get('/api/faces/'+faces[0]+'/thumbnail').status_code==404
    assert client.get('/api/faces/history?page=6').status_code==400
    # Missing derived files may fall back to a read-only original, without changing its EXIF or bytes.
    with Session() as session:
        face=session.get(DetectedFace,faces[0]);face.location={'left':.1,'top':.1,'right':.9,'bottom':.9}
        photo=session.get(Photo,face.photo_id);photo.thumbnail_path=None;photo.preview_path=None;session.commit()
    response=client.get('/api/faces/'+faces[0]+'/thumbnail');assert response.status_code==200 and response.headers['content-type']=='image/webp'
    assert all(hashlib.sha256(p.read_bytes()).hexdigest()==h for p,h in hashes.items())

def test_schema12_upgrade_backup_failure_copy_and_identity(client,image_factory,tmp_path,monkeypatch):
    from backend.app import migrations
    from backend.migrate_storage import migrate as copy_library
    people,faces,_=setup_people(client,image_factory);a=people[0]
    event=client.patch(f'/api/faces/persons/{a}/cover',json={'face_id':faces[1],'revision':revision(client,a)})
    copied_folder=tmp_path/'copied';copy_library(Path(engine.url.database).parent,copied_folder);copied=copied_folder/'library.db'
    with sqlite3.connect(copied) as db:
        assert db.execute('SELECT count(*) FROM face_operations').fetchone()[0]==1
        assert db.execute('SELECT face_id FROM face_covers WHERE person_id=?',(a,)).fetchone()[0]==faces[1]
        original_id=db.execute('SELECT library_id FROM library_profile').fetchone()[0]
        db.execute('DROP TABLE face_operations');db.execute('DROP TABLE face_covers');db.execute('DROP TABLE face_merges');db.execute('PRAGMA user_version=12');db.commit()
        before=db.execute('SELECT id,person_id,encoding,confirmed,model_space FROM detected_faces ORDER BY id').fetchall()
    with monkeypatch.context() as patch:
        patch.setattr(migrations,'backup_database',lambda *_:(_ for _ in ()).throw(OSError('synthetic backup failure')))
        with pytest.raises(OSError):migrations.migrate_database(copied)
    with sqlite3.connect(copied) as db:assert db.execute('PRAGMA user_version').fetchone()[0]==12
    assert set(migrations.migrate_database(copied))=={'face_operations','face_covers','face_merges'}
    assert migrations.migrate_database(copied)==[]
    with sqlite3.connect(copied) as db:
        assert db.execute('PRAGMA user_version').fetchone()[0]==SCHEMA_VERSION and db.execute('PRAGMA foreign_key_check').fetchall()==[]
        assert db.execute('SELECT id,person_id,encoding,confirmed,model_space FROM detected_faces ORDER BY id').fetchall()==before
        assert db.execute('SELECT library_id FROM library_profile').fetchone()[0]==original_id
    undo(client,event)

def test_library_merge_maps_alias_covers_but_never_imports_foreign_undo(client,image_factory,tmp_path):
    from backend.app.migrations import backup_database
    from backend.library_maintenance import merge_libraries
    empty=backup_database(Path(engine.url.database),tmp_path/'empty.db')
    people,faces,hashes=setup_people(client,image_factory);a,b,_=people
    collision=backup_database(Path(engine.url.database),tmp_path/'collision.db')
    event=client.post('/api/faces/merge',json={'source_ids':[a],'target_id':b,'revisions':{p:revision(client,p) for p in (a,b)}})
    assert event.status_code==200,event.text
    assert client.patch(f'/api/faces/persons/{b}/cover',json={'face_id':faces[0],'revision':revision(client,b)}).status_code==200
    source=backup_database(Path(engine.url.database),tmp_path/'incoming.db')
    for target,label in [(empty,'new'),(collision,'collision')]:
        stage=tmp_path/(label+'-stage.db');merge_libraries(target,source,stage,tmp_path/'absent',tmp_path/'moved')
        with sqlite3.connect(stage) as db:
            assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
            assert db.execute('SELECT count(*) FROM face_operations').fetchone()[0]==0
            if label=='new':
                assert db.execute('SELECT target_id FROM face_merges WHERE source_id=?',(a,)).fetchone()[0]==b
                assert db.execute('SELECT face_id FROM face_covers WHERE person_id=?',(b,)).fetchone()[0]==faces[0]
                assert db.execute('SELECT count(*) FROM detected_faces WHERE person_id=?',(b,)).fetchone()[0]==3
            else:
                assert db.execute('SELECT count(*) FROM face_merges').fetchone()[0]==0
                assert db.execute('SELECT count(*) FROM detected_faces WHERE person_id=?',(a,)).fetchone()[0]==2
    assert all(hashlib.sha256(p.read_bytes()).hexdigest()==h for p,h in hashes.items())
    # An offline merge must not import application configuration, open the default
    # library, or require FastAPI merely to follow person aliases.
    import subprocess,sys
    subprocess.run([sys.executable,'-c',"import sys;from pathlib import Path;from backend.library_maintenance import merge_libraries;merge_libraries(*map(Path,sys.argv[1:]));assert 'backend.app.models' not in sys.modules;assert 'backend.app.config' not in sys.modules;assert 'fastapi' not in sys.modules",
        str(empty),str(source),str(tmp_path/'cold-stage.db'),str(tmp_path/'absent'),str(tmp_path/'moved')],check=True,capture_output=True)

def test_history_is_private_bounded_and_corruption_or_other_library_cannot_replay(client,image_factory):
    import zlib
    people,faces,_=setup_people(client,image_factory);a=people[0]
    first=client.patch(f'/api/faces/persons/{a}/cover',json={'face_id':faces[0],'revision':revision(client,a)}).json()['operation_id']
    with Session() as session:
        event=session.get(FaceOperation,first)
        # Corruption is rejected before any memberships are restored.
        saved=event.before_state;event.before_state=zlib.compress(b'{broken');session.commit()
    assert client.post('/api/faces/history/'+first+'/undo').status_code==400
    with Session() as session:
        event=session.get(FaceOperation,first);event.before_state=saved
        for index in range(101):session.add(FaceOperation(library_id=event.library_id,kind='cover',context=event.context,before_state=saved,after_hash=event.after_hash,created_at=f'2000-01-01T00:00:{index:03}'))
        session.commit()
    assert client.patch(f'/api/faces/persons/{a}/cover',json={'face_id':faces[1],'revision':revision(client,a)}).status_code==200
    with Session() as session:
        assert len(session.scalars(select(FaceOperation)).all())==100
        event=session.get(FaceOperation,first);event.library_id='foreign-library';session.commit()
    assert client.post('/api/faces/history/'+first+'/undo').status_code==404
    result=client.get('/api/faces/history').json();assert result['has_more'] and len(result['items'])==20 and not any(x['id']==first for x in result['items'])
