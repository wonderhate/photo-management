"""Finite, opt-in import work in synthetic libraries; no models or network."""
from hashlib import sha256
from io import BytesIO
from threading import Event, Thread
import shutil
import numpy as np
import pytest
from sqlalchemy import select
from backend.app import config
from backend.app.models import Session, Photo, CaptureGroup, DetectedFace
from backend.app.services import face_service, jobs, import_face_analysis, thumbnail_service
from test_library import import_paths, wait_job
from test_progressive_import import drained, eventually


@pytest.fixture(autouse=True)
def isolated_policy(client,tmp_path,monkeypatch):
    drained();monkeypatch.setattr(config,'SETTINGS_FILE',tmp_path/'settings.json')
    def offline(*a,**k):raise AssertionError('No download or network is allowed')
    monkeypatch.setattr(face_service,'download_models',offline)
    monkeypatch.setattr(face_service.urllib.request,'urlopen',offline)
    yield
    drained()


def ready(monkeypatch,value=True):
    monkeypatch.setattr(face_service,'status',lambda:dict(available=value,dependency=True,cached=value))


def detect(monkeypatch):
    calls=[];vector=np.array([1]+[0]*127,dtype='float32').tobytes().hex()
    def run(path):
        calls.append(path)
        return [dict(encoding=vector,location=dict(left=.1,top=.1,right=.8,bottom=.8))]
    monkeypatch.setattr(face_service,'detect_faces',run)
    return calls


def hashes(paths):return [sha256(p.read_bytes()).hexdigest() for p in paths]


def test_default_manual_strict_policy_and_general_preferences_preserve_opt_in(client,image_factory,monkeypatch):
    ready(monkeypatch);calls=detect(monkeypatch)
    assert client.get('/api/faces/import-policy').json()['enabled'] is False
    paths=[image_factory('manual.jpg')];before=hashes(paths)
    monkeypatch.setattr(face_service,'is_available',lambda:pytest.fail('Disabled imports must not check models'))
    with monkeypatch.context() as guard:
        guard.setattr(face_service,'try_status',lambda:pytest.fail('Disabled imports must not inspect face models'))
        result=import_paths(client,paths)
    assert 'auto_face_analysis' not in result and calls==[]
    for value in ['true',1,None]:assert client.put('/api/faces/import-policy',json={'enabled':value}).status_code==422
    assert client.put('/api/faces/import-policy',json={'enabled':True,'extra':1}).status_code==422
    assert client.put('/api/faces/import-policy',json={'enabled':True}).json()['enabled'] is True
    assert client.put('/api/settings',json={'count_mode':'file'}).status_code==200
    assert client.get('/api/faces/import-policy').json()['enabled'] is True
    assert config.settings()['auto_face_analysis'] is True and hashes(paths)==before


def test_only_new_ids_despite_duplicates_relocation_partial_failure_and_upload_collect_ids(client,image_factory,tmp_path,monkeypatch):
    ready(monkeypatch);calls=detect(monkeypatch)
    old=image_factory('old.jpg');old_job=import_paths(client,[old]);assert calls==[]
    old_id=client.get('/api/photos').json()['photos'][0]['id']
    with Session() as session:
        photo=session.get(Photo,old_id);photo.face_data={'manual':'keep'};photo.file_path=str(tmp_path/'missing.jpg');session.commit()
    copy=tmp_path/'copy.jpg';shutil.copyfile(old,copy)
    new=image_factory('new.jpg',color=(12,14,90));duplicate=tmp_path/'same.jpg';shutil.copyfile(new,duplicate)
    paths=[old,copy,new,duplicate];before=hashes(paths)
    assert client.put('/api/faces/import-policy',json={'enabled':True}).status_code==200
    result=import_paths(client,[copy,new,duplicate,tmp_path/'missing.png']);drained()
    assert (result['success'],result['skipped'],result['failed'])==(1,2,1)
    auto=jobs.get(result['auto_face_analysis']['job_id']);assert auto['kind']=='faces-import' and auto['resource']=='local-ai' and not auto['billable']
    assert auto['status']=='completed' and auto['success']==1 and auto['total']==1 and len(calls)==1
    with Session() as session:assert session.get(Photo,old_id).face_data=={'manual':'keep'}
    repeated=import_paths(client,[copy,new]);drained();assert repeated['auto_face_analysis']==dict(status='no_new_photos',new_count=0) and len(calls)==1
    upload=image_factory('upload.jpg',color=(21,3,74));original=upload.read_bytes()
    response=client.post('/api/photos/upload',files=[('files',('again.jpg',BytesIO(new.read_bytes()),'image/jpeg')),('files',('upload.jpg',BytesIO(original),'image/jpeg'))]);assert response.status_code==202
    uploaded=wait_job(client,response.json());drained();assert len(uploaded['photo_ids'])==2 and uploaded['auto_face_analysis']['new_count']==1 and len(calls)==2
    with Session() as session:
        faces=session.scalars(select(DetectedFace)).all();assert len(faces)==2 and all(not face.confirmed for face in faces)
    assert hashes(paths)==before and upload.read_bytes()==original and jobs.get(old_job['id'])['status']=='completed'


def test_unavailable_models_and_optional_queue_failure_do_not_fail_import_or_retry(client,image_factory,monkeypatch):
    ready(monkeypatch,False);calls=detect(monkeypatch)
    client.put('/api/faces/import-policy',json={'enabled':True})
    paths=[image_factory('missing-model.jpg'),image_factory('queue-full.jpg',color=(3,18,97))];before=hashes(paths)
    first=import_paths(client,[paths[0]]);assert first['auto_face_analysis']['status']=='models_unavailable' and first['success']==1 and calls==[]
    ready(monkeypatch);submit=jobs.submit
    def full(kind,*a,**k):
        if kind=='faces-import':raise ValueError('Queue unavailable')
        return submit(kind,*a,**k)
    monkeypatch.setattr(jobs,'submit',full)
    second=import_paths(client,[paths[1]]);drained();assert second['auto_face_analysis']['status']=='unavailable' and second['success']==1
    assert not any(j['kind']=='faces-import' for j in jobs.recent()) and calls==[] and hashes(paths)==before


def test_disabling_cancels_queued_auto_work_without_cancelling_manual_analysis_or_replaying(client,image_factory,monkeypatch):
    ready(monkeypatch);calls=detect(monkeypatch);started=Event();release=Event()
    def hold(_id):started.set();assert release.wait(8)
    manual=jobs.submit('faces',hold);assert started.wait(3)
    try:
        client.put('/api/faces/import-policy',json={'enabled':True})
        path=image_factory('queued.jpg');before=hashes([path]);root=import_paths(client,[path]);auto=root['auto_face_analysis']['job_id']
        assert jobs.get(auto)['status']=='queued' and jobs.get(manual['id'])['status']=='running'
        client.put('/api/faces/import-policy',json={'enabled':False});assert jobs.get(auto)['status']=='cancelled' and not jobs.get(manual['id']).get('cancelled')
        client.put('/api/faces/import-policy',json={'enabled':True})
    finally:release.set();drained()
    assert jobs.get(manual['id'])['status']=='completed' and jobs.get(auto)['status']=='cancelled' and calls==[] and hashes([path])==before
    repeated=import_paths(client,[path]);drained();assert repeated['auto_face_analysis']['status']=='no_new_photos' and calls==[]


def test_disabling_running_detection_prevents_publication_and_browsing_is_available(client,image_factory,monkeypatch):
    ready(monkeypatch);calls=detect(monkeypatch);original=face_service.detect_faces;started=Event();release=Event()
    def hold(path):started.set();assert release.wait(8);return original(path)
    monkeypatch.setattr(face_service,'detect_faces',hold)
    client.put('/api/faces/import-policy',json={'enabled':True});path=image_factory('running.jpg');before=hashes([path])
    try:
        root=import_paths(client,[path]);assert started.wait(3)
        photo=client.get('/api/photos').json()['photos'][0];assert client.patch('/api/photos/'+photo['id'],json={'rating':5}).status_code==200
        assert root['status']=='completed' and jobs.get(root['auto_face_analysis']['job_id'])['status']=='running'
        assert client.put('/api/faces/import-policy',json={'enabled':False}).status_code==200
    finally:release.set();drained()
    assert jobs.get(root['auto_face_analysis']['job_id'])['status']=='cancelled' and len(calls)==1
    with Session() as session:
        saved=session.get(Photo,photo['id']);assert saved.face_data=={} and saved.rating==5
        assert session.scalar(select(DetectedFace.id)) is None
    assert hashes([path])==before


def test_enable_during_import_does_not_opt_it_in_and_late_members_do_not_expand_scope(client,image_factory,monkeypatch):
    ready(monkeypatch);calls=detect(monkeypatch);started=Event();release=Event();generate=thumbnail_service.generate
    def hold(path,id):started.set();assert release.wait(8);return generate(path,id)
    monkeypatch.setattr(thumbnail_service,'generate',hold)
    path=image_factory('already-running.jpg');before=hashes([path])
    job=client.post('/api/photos/import',json={'paths':[str(path)]}).json()
    try:
        assert started.wait(3);client.put('/api/faces/import-policy',json={'enabled':True})
    finally:release.set();drained()
    assert 'auto_face_analysis' not in jobs.get(job['id']) and calls==[]
    monkeypatch.setattr(thumbnail_service,'generate',generate)
    occupied=Event();free=Event()
    def busy(_id):occupied.set();assert free.wait(8)
    blocker=jobs.submit('faces',busy);assert occupied.wait(3)
    try:
        paths=[image_factory('deleted.jpg',color=(11,2,3)),image_factory('nonpreferred.jpg',color=(22,2,3))]
        before+=hashes(paths);root=import_paths(client,paths);photos=client.get('/api/photos?count_mode=file').json()['photos'];by_name={p['file_name']:p for p in photos}
        assert client.delete('/api/photos/'+by_name['deleted.jpg']['id']).status_code==200
        with Session() as session:
            photo=session.get(Photo,by_name['nonpreferred.jpg']['id']);group=session.get(CaptureGroup,photo.capture_group_id)
            group.preferred_photo_id=by_name['already-running.jpg']['id'];session.commit()
    finally:free.set();drained()
    auto=jobs.get(root['auto_face_analysis']['job_id']);assert auto['status']=='completed' and auto['skipped']==2 and auto['total']==2 and calls==[]
    assert hashes([path]+paths)==before and jobs.get(blocker['id'])['status']=='completed'


def test_busy_engine_does_not_block_import_or_disable_and_cancel_wins_late_model_check(client,image_factory):
    assert client.put('/api/faces/import-policy',json={'enabled':True}).status_code==200
    started=Event();release=Event()
    def occupy():
        with face_service.lock:started.set();assert release.wait(8)
    worker=Thread(target=occupy);worker.start();assert started.wait(3)
    path=image_factory('busy-engine.jpg');before=hashes([path])
    try:
        assert client.get('/api/faces/import-policy').json()['reason']=='busy'
        root=import_paths(client,[path]);assert root['status']=='completed' and root['auto_face_analysis']['status']=='scheduled'
        assert client.put('/api/faces/import-policy',json={'enabled':False}).json()['enabled'] is False
    finally:release.set();worker.join(3);drained()
    assert jobs.get(root['auto_face_analysis']['job_id'])['status']=='cancelled' and hashes([path])==before


def test_off_then_on_during_import_does_not_revive_its_previous_permission(client,image_factory,monkeypatch):
    ready(monkeypatch);calls=detect(monkeypatch);started=Event();release=Event();generate=thumbnail_service.generate
    client.put('/api/faces/import-policy',json={'enabled':True})
    def hold(path,id):started.set();assert release.wait(8);return generate(path,id)
    monkeypatch.setattr(thumbnail_service,'generate',hold)
    path=image_factory('permission-changed.jpg');before=hashes([path]);job=client.post('/api/photos/import',json={'paths':[str(path)]}).json()
    try:
        assert started.wait(3)
        client.put('/api/faces/import-policy',json={'enabled':False});client.put('/api/faces/import-policy',json={'enabled':True})
    finally:release.set();drained()
    root=jobs.get(job['id']);assert root['status']=='completed' and root['auto_face_analysis']==dict(status='disabled',new_count=1)
    assert calls==[] and hashes([path])==before
