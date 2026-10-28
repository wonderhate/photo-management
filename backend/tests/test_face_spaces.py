from backend.app.migrations import SCHEMA_VERSION
import sqlite3
from pathlib import Path
import hashlib
import sys
from types import SimpleNamespace
import numpy as np
import pytest
from sqlalchemy import select,func
from backend.app.models import Session,Photo,FacePerson,DetectedFace,FacePrototype,FaceModelSpace,engine
from backend.app.services import face_space,face_service,jobs
from backend.app import migrations
from backend.library_maintenance import merge_libraries
from backend.migrate_storage import migrate as copy_library
from test_library import import_paths
from test_metadata import digest

BBOX=dict(left=.1,top=.1,right=.8,bottom=.8)
VECTOR=np.array([1]+[0]*127,dtype='<f4').tobytes()

def fixture_people(client,image_factory,count=4):
    originals=[image_factory('space-'+str(i)+'.jpg',color=(20+i*20,90,140)) for i in range(count)]
    before=[digest(p) for p in originals];import_paths(client,originals)
    by_name={p['file_name']:p['id'] for p in client.get('/api/photos').json()['photos']}
    return originals,before,[by_name[p.name] for p in originals]

def test_model_spaces_never_compare_equal_length_foreign_vectors_and_manual_people_survive(client,image_factory,monkeypatch,tmp_path):
    originals,before,ids=fixture_people(client,image_factory)
    with Session() as s:
        legacy=FacePerson(name='Legacy retained',representative_encoding=VECTOR);s.add(legacy);s.flush();legacy_id=legacy.id
        s.add(FacePrototype(person_id=legacy_id,model_space=face_space.LEGACY_SPACE,encoding=VECTOR,dimensions=128))
        s.add(DetectedFace(id='preserved-legacy-face',photo_id=ids[3],person_id=legacy_id,face_index=0,encoding=VECTOR,location=BBOX,confirmed=True));s.get(Photo,ids[3]).face_data={'model':face_space.MODEL,'count':1};s.commit()
    a=face_space.contract()|{'pipeline':'fixture-a'};b=a|{'pipeline':'fixture-b'};active=[a];calls=[]
    monkeypatch.setattr(face_service,'active_contract',lambda:dict(active[0]))
    monkeypatch.setattr(face_service,'detect_faces',lambda path:calls.append(path) or [dict(encoding=VECTOR.hex(),location=BBOX)])
    face_service.detect_photo(ids[0])
    with Session() as s:person=s.scalar(select(DetectedFace).where(DetectedFace.photo_id==ids[0])).person_id
    assert person!=legacy_id;client.patch('/api/faces/persons/'+person,json={'name':'Preserved person'});client.post('/api/faces/persons/'+person+'/confirm')
    album=client.post('/api/albums',json={'name':'Preserved snapshot','person_id':person}).json();target=migrations.backup_database(Path(engine.url.database),tmp_path/'target.db')
    with Session() as s:old_face=s.scalar(select(DetectedFace).where(DetectedFace.photo_id==ids[0]));old=(old_face.id,old_face.encoding,old_face.location,old_face.confirmed,s.get(Photo,ids[0]).face_data,s.get(FacePerson,person).representative_encoding)
    active[0]=b;face_service.detect_photo(ids[1]);face=next(f for f in client.get('/api/faces/review').json()['faces'] if f['photo_id']==ids[1]);other=face['person_id'];assert other!=person and face['model_space']==face_space.identity(b)
    assert client.patch('/api/faces/detections/'+face['id'],json={'person_id':person}).status_code==200
    with Session() as s:assert s.get(FacePrototype,(other,face_space.identity(b))) is None
    face_service.detect_photo(ids[2]);assert len(calls)==3
    assert face_service.detect_photo(ids[0])['cached'] and len(calls)==3
    with Session() as s:
        saved=s.get(DetectedFace,old[0]);assert (saved.id,saved.encoding,saved.location,saved.confirmed,s.get(Photo,ids[0]).face_data,s.get(FacePerson,person).representative_encoding)==old
        assert s.scalar(select(DetectedFace).where(DetectedFace.photo_id==ids[2])).person_id==person
        assert s.get(FacePrototype,(person,face_space.identity(a))).encoding==VECTOR
        assert s.get(FacePrototype,(person,face_space.identity(b))).encoding==VECTOR
        assert s.get(DetectedFace,'preserved-legacy-face').confirmed and s.get(FacePerson,legacy_id).representative_encoding==VECTOR
    assert client.get('/api/albums/'+album['id']).json()['count']==1
    source=migrations.backup_database(Path(engine.url.database),tmp_path/'source.db');stage=tmp_path/'merged.db';merge_libraries(target,source,stage,tmp_path/'unrelated',tmp_path/'moved')
    with sqlite3.connect(stage) as db:
        assert len(db.execute('SELECT model_space FROM face_prototypes WHERE person_id=?',(person,)).fetchall())==2
        assert db.execute('SELECT confirmed FROM detected_faces WHERE id=?',(old[0],)).fetchone()[0]==1
        assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
    assert [digest(p) for p in originals]==before

def test_bad_vectors_cancelled_or_stale_detection_cannot_replace_records(client,image_factory,monkeypatch):
    originals,before,ids=fixture_people(client,image_factory,2)
    bad=[np.zeros(128,dtype='<f4').tobytes().hex(),np.full(128,np.nan,dtype='<f4').tobytes().hex(),VECTOR[:-4].hex()]
    for value in bad:
        monkeypatch.setattr(face_service,'detect_faces',lambda path:[dict(encoding=value,location=BBOX)])
        with pytest.raises(ValueError,match='embedding'):face_service.detect_photo(ids[0])
    monkeypatch.setattr(face_service,'detect_faces',lambda path:[dict(encoding=VECTOR.hex(),location=BBOX|{'left':.9})])
    with pytest.raises(ValueError,match='observation'):face_service.detect_photo(ids[0])
    monkeypatch.setattr(face_service,'detect_faces',lambda path:[dict(encoding=VECTOR.hex(),location=BBOX)])
    calls=[]
    def cancel():
        calls.append(1)
        if len(calls)>1:raise jobs.JobCancelled()
    with pytest.raises(jobs.JobCancelled):face_service.detect_photo(ids[0],check=cancel)
    with Session() as s:
        assert not s.get(Photo,ids[0]).face_data and s.scalar(select(func.count()).select_from(DetectedFace))==0
        assert s.scalar(select(func.count()).select_from(FacePrototype))==0
    def confirmed_during_inference(path):
        with Session() as s:
            p=FacePerson(name='Concurrent manual person');s.add(p);s.flush();s.add(DetectedFace(photo_id=ids[0],person_id=p.id,face_index=0,encoding=VECTOR,location=BBOX,confirmed=True));s.commit()
        return [dict(encoding=VECTOR.hex(),location=BBOX)]
    monkeypatch.setattr(face_service,'detect_faces',confirmed_during_inference);assert face_service.detect_photo(ids[0])['cached']
    with Session() as s:assert s.scalar(select(DetectedFace).where(DetectedFace.photo_id==ids[0])).confirmed
    def stale_source(path):
        with Session() as s:s.get(Photo,ids[1]).file_hash='f'*64;s.commit()
        return [dict(encoding=VECTOR.hex(),location=BBOX)]
    monkeypatch.setattr(face_service,'detect_faces',stale_source)
    with pytest.raises(ValueError,match='来源'):face_service.detect_photo(ids[1])
    changed=face_space.contract()|{'pipeline':'changed-during-inference'}
    def changed_model(path):
        monkeypatch.setattr(face_service,'active_contract',lambda:changed)
        return [dict(encoding=VECTOR.hex(),location=BBOX)]
    monkeypatch.setattr(face_service,'detect_faces',changed_model)
    with pytest.raises(ValueError,match='模型已改变'):face_service.detect_photo(ids[1])
    with Session() as s:assert not s.get(Photo,ids[1]).face_data
    assert [digest(p) for p in originals]==before

def test_schema11_face_upgrade_backs_up_before_changes_and_preserves_unknown_vectors(client,image_factory,tmp_path,monkeypatch):
    originals,before,ids=fixture_people(client,image_factory,1)
    with Session() as s:
        person=FacePerson(name='Legacy confirmed',representative_encoding=VECTOR);s.add(person);s.flush();s.add(DetectedFace(id='legacy-face',photo_id=ids[0],person_id=person.id,face_index=0,encoding=VECTOR,location=BBOX,confirmed=True));s.get(Photo,ids[0]).face_data={'model':face_space.MODEL,'count':1};s.commit();pid=person.id
    with sqlite3.connect(engine.url.database) as db:
        db.execute('PRAGMA foreign_keys=ON');db.execute('INSERT INTO detected_faces(id,photo_id,person_id,face_index,encoding,location,confirmed) VALUES (?,?,?,?,?,?,?)',('raw-default',ids[0],pid,99,VECTOR,'{}',1))
        assert db.execute("SELECT model_space FROM detected_faces WHERE id='raw-default'").fetchone()[0]==face_space.LEGACY_SPACE;db.rollback()
    folder=tmp_path/'old-library';folder.mkdir();path=migrations.backup_database(Path(engine.url.database),folder/'library.db')
    with sqlite3.connect(path) as db:
        db.execute('DROP TABLE face_prototypes')
        db.execute('''CREATE TABLE legacy_detected_faces(id VARCHAR PRIMARY KEY,photo_id VARCHAR NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
            person_id VARCHAR REFERENCES face_persons(id) ON DELETE SET NULL,face_index INTEGER NOT NULL,encoding BLOB NOT NULL,location JSON NOT NULL,confirmed BOOLEAN NOT NULL)''')
        db.execute('INSERT INTO legacy_detected_faces SELECT id,photo_id,person_id,face_index,encoding,location,confirmed FROM detected_faces')
        db.execute('DROP TABLE detected_faces');db.execute('ALTER TABLE legacy_detected_faces RENAME TO detected_faces');db.execute('DROP TABLE face_model_spaces');db.execute('PRAGMA user_version=11');db.commit()
    old=path.read_bytes()
    with monkeypatch.context() as patch:
        patch.setattr(migrations,'backup_database',lambda *a,**k:(_ for _ in ()).throw(OSError('Synthetic face backup failure')))
        with pytest.raises(OSError):migrations.migrate_database(path)
    assert path.read_bytes()==old
    migrations.migrate_database(path);assert migrations.migrate_database(path)==[];backups=list((folder/'backups').glob('*.db'));assert len(backups)==1
    with sqlite3.connect(backups[0]) as db:assert db.execute('PRAGMA user_version').fetchone()[0]==11
    with sqlite3.connect(path) as db:
        assert db.execute('PRAGMA user_version').fetchone()[0]==SCHEMA_VERSION
        assert db.execute('SELECT name,representative_encoding FROM face_persons WHERE id=?',(pid,)).fetchone()==('Legacy confirmed',VECTOR)
        assert db.execute('SELECT model_space,encoding,confirmed FROM detected_faces').fetchone()==(face_space.LEGACY_SPACE,VECTOR,1)
        assert db.execute('SELECT model_space,encoding,dimensions FROM face_prototypes').fetchone()==(face_space.LEGACY_SPACE,VECTOR,128)
        assert db.execute('SELECT verified FROM face_model_spaces').fetchone()[0]==0
    target=tmp_path/'copied';copy_library(folder,target)
    with sqlite3.connect(target/'library.db') as db:assert db.execute('SELECT encoding FROM face_prototypes').fetchone()[0]==VECTOR
    assert [digest(p) for p in originals]==before

def test_model_integrity_pins_weights_and_reloads_engines_without_downloads(client,image_factory,monkeypatch,tmp_path):
    path=image_factory('model-probe.jpg');before=digest(path);model_dir=tmp_path/'model-fixtures';folder=model_dir/'faces';folder.mkdir(parents=True);monkeypatch.setattr(face_service,'MODELS',model_dir)
    for i,(name,(sub,_)) in enumerate(list(face_space.FILES.items())):
        value=('synthetic model '+str(i)).encode();(folder/name).write_bytes(value);monkeypatch.setitem(face_space.FILES,name,(sub,hashlib.sha256(value).hexdigest()))
    monkeypatch.setattr(face_service,'_engines',None);monkeypatch.setattr(face_service,'_engine_key',None);monkeypatch.setattr(face_service,'_integrity',None)
    original_spec=face_service.importlib.util.find_spec;monkeypatch.setattr(face_service.importlib.util,'find_spec',lambda name:SimpleNamespace() if name=='cv2' else original_spec(name))
    created=[]
    class Detector:
        def setInputSize(self,size):pass
        def detect(self,frame):return None,np.array([[10,10,100,100]+[0]*11],dtype='float32')
    class Recognizer:
        def alignCrop(self,frame,face):return frame
        def feature(self,frame):return np.frombuffer(VECTOR,dtype='<f4').reshape(1,128)
    fake=SimpleNamespace(FaceDetectorYN=SimpleNamespace(create=lambda *args:created.append('detector') or Detector()),FaceRecognizerSF=SimpleNamespace(create=lambda *args:created.append('recognizer') or Recognizer()))
    monkeypatch.setitem(sys.modules,'cv2',fake);monkeypatch.setattr(face_service.urllib.request,'urlopen',lambda *a,**k:pytest.fail('No network should be used'))
    assert face_service.status()['integrity']=='ready';space_a=face_service.status()['model_space'];assert len(face_service.detect_faces(path))==1;face_service.detect_faces(path);assert len(created)==2
    name='face_recognition_sface_2021dec.onnx';(folder/name).write_bytes(b'synthetic replacement')
    assert face_service.status()['integrity']=='invalid' and not face_service.status()['available']
    with pytest.raises(ValueError):face_service.detect_faces(path)
    sub,_=face_space.FILES[name];monkeypatch.setitem(face_space.FILES,name,(sub,hashlib.sha256((folder/name).read_bytes()).hexdigest()));assert face_service.status()['model_space']!=space_a
    face_service.detect_faces(path);assert len(created)==4 and digest(path)==before
    class MutatingRecognizer(Recognizer):
        def feature(self,frame):
            (folder/name).write_bytes(b'changed while extracting a vector');return super().feature(frame)
    fake.FaceRecognizerSF.create=lambda *args:MutatingRecognizer();monkeypatch.setattr(face_service,'_engines',None)
    with pytest.raises(ValueError,match='模型已改变'):face_service.detect_faces(path)
    assert digest(path)==before

def test_face_contract_rejects_bad_versions_dimensions_and_metadata():
    manifest=face_space.contract()
    for delta in [{'version':True},{'dimensions':True},{'dimensions':0},{'dimensions':5000},{'pipeline':'\0'},{'engine':'x'*161},{'recognizer_sha256':'unknown'}]:
        with pytest.raises(ValueError):face_space.identity(manifest|delta)
    assert face_space.identity(manifest)!=face_space.identity(manifest|{'pipeline':manifest['pipeline']+'-next'})
