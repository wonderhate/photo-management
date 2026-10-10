import numpy as np
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
