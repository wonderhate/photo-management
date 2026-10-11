import hashlib
import numpy as np
from sqlalchemy import select
from backend.app.models import Session, Photo, AlbumPhoto, DetectedFace
from backend.app.services import face_service
from test_library import import_paths,wait_job

def test_face_cluster_confirm_reassign_and_safe_delete(client,image_factory,monkeypatch):
    originals=[image_factory('one.jpg'),image_factory('two.jpg',color=(1,2,3))]
    import_paths(client,originals)
    vector=np.array([1,0,0],dtype='float32').tobytes().hex()
    calls=[]
    def detect(path):
        calls.append(path)
        return [{'encoding':vector,'location':{'left':.1,'right':.8,'top':.1,'bottom':.8}}]
    monkeypatch.setattr(face_service,'is_available',lambda:True)
    monkeypatch.setattr(face_service,'detect_faces',detect)
    job=client.post('/api/faces/analyze',json={}).json()
    assert wait_job(client,job)['success']==2
    people=client.get('/api/faces/persons').json();assert len(people)==1 and people[0]['photo_count']==2
    person=people[0]['id']
    assert client.get('/api/faces/persons/'+person+'/photos?page_size=1').json()['total']==2
    assert client.post('/api/faces/persons/'+person+'/confirm').status_code==200
    assert client.get('/api/faces/review').json()['total']==0
    face=client.get('/api/faces/review',params={'person_id':person}).json()['faces'][0]
    assert client.get(face['thumbnail_url']).status_code==200
    other=client.post('/api/faces/persons',json={'name':'摄影师'}).json()['id']
    assert client.patch('/api/faces/detections/'+face['id'],json={'person_id':other}).status_code==200
    assert client.get('/api/photos',params={'person_id':other}).json()['total']==1
    assert client.post('/api/faces/persons',json={'name':'摄影师'}).status_code==409
    assert client.post('/api/faces/persons',json={'name':'  '}).status_code==422
    assert wait_job(client,client.post('/api/faces/analyze',json={}).json())['skipped']==2
    assert len(calls)==2
    assert client.delete('/api/faces/persons/'+other).status_code==200
    assert all(path.is_file() for path in originals)
    assert client.get('/api/faces/review').json()['total']==1

def test_faces_unavailable_is_not_no_face_result(client,monkeypatch):
    monkeypatch.setattr(face_service,'is_available',lambda:False)
    assert client.post('/api/faces/analyze',json={}).status_code==503


def test_confirmed_person_album_includes_all_captures_and_preserves_originals(client,image_factory,tmp_path):
    originals=[image_factory(f'person-{i:03}.jpg',month=i//28+1,day=i%28+1,color=(i,30,100)) for i in range(81)]
    raw=tmp_path/'person-000.ARW';raw.write_bytes(b'synthetic raw')
    unrelated=image_factory('unrelated.jpg',color=(250,0,0))
    paths=originals+[raw,unrelated]
    hashes={path:hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}
    assert import_paths(client,paths)['success']==len(paths)
    with Session() as session:
        by_name={photo.file_name:photo.id for photo in session.scalars(select(Photo))}
    person=client.post('/api/faces/persons',json={'name':'家人'}).json()['id']
    empty=client.post('/api/faces/persons',json={'name':'空人物'}).json()['id']
    with Session() as session:
        # The RAW member and a duplicate detection must still count as one capture.
        for path in originals[1:]+[raw,raw]:
            session.add(DetectedFace(photo_id=by_name[path.name],person_id=person,face_index=0,encoding=b'',location={}))
        session.commit()
    payload={'name':' 家人影集 ','person_id':person}
    assert client.post('/api/albums',json=payload).status_code==400
    assert client.post('/api/albums',json={'name':'空','person_id':empty}).status_code==400
    assert client.post('/api/albums',json={'name':'未知','person_id':'missing'}).status_code==404
    assert client.get('/api/albums').json()==[]
    assert client.post('/api/faces/persons/'+person+'/confirm').status_code==200
    assert client.get('/api/faces/persons/'+person+'/photos').json()['total']==81
    assert len(client.get('/api/faces/persons/'+person+'/photos').json()['photos'])==80
    assert client.post('/api/albums',json=payload|{'type':'smart','keywords':['家人']}).status_code==400
    assert client.post('/api/albums',json=payload|{'photo_ids':[by_name[unrelated.name]]}).status_code==400
    assert client.post('/api/albums',json=payload|{'name':'  '}).status_code==422
    result=client.post('/api/albums',json=payload)
    assert result.status_code==200,result.text
    album=result.json()
    assert (album['name'],album['type'],album['count'])==('家人影集','normal',81)
    expected={by_name[path.name] for path in originals}
    members=client.get('/api/photos',params={'album_id':album['id'],'page_size':200}).json()
    assert members['total']==81 and {photo['id'] for photo in members['photos']}==expected
    with Session() as session:
        saved=session.scalars(select(AlbumPhoto).where(AlbumPhoto.album_id==album['id'])).all()
        assert len(saved)==81 and {item.photo_id for item in saved}==expected
        assert sorted(item.position for item in saved)==list(range(81))
    assert client.delete('/api/faces/persons/'+person).status_code==200
    assert client.get('/api/albums/'+album['id']).json()['count']==81
    assert client.delete('/api/albums/'+album['id']).status_code==200
    assert all(hashlib.sha256(path.read_bytes()).hexdigest()==hashes[path] for path in paths)
