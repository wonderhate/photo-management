"""Exercise real task coordination and SQLite caches without model downloads."""
import hashlib
import sys
import time
from contextlib import nullcontext
from importlib.machinery import ModuleSpec
from threading import Event
from types import SimpleNamespace
import numpy as np
from sqlalchemy import select
from backend.app.models import Session, Embedding
from backend.app.services import jobs
from backend.app.services.embedding_service import EmbeddingService
from test_library import import_paths


def drained():
    deadline=time.monotonic()+5
    while jobs.resources()['pending'] and time.monotonic()<deadline:time.sleep(.01)
    assert jobs.resources()['pending']==0


def test_semantic_queue_shares_face_resource_and_waiting_cancel_can_restart(client,monkeypatch):
    drained();instance=EmbeddingService();started=Event();release=Event();calls=[]
    def face(_id):started.set();assert release.wait(5)
    def load(download,child):calls.append(download);return object(),object(),'cpu','synthetic-verified-space',{}
    monkeypatch.setattr(instance,'_load_model',load)
    monkeypatch.setattr(instance,'index',lambda child:jobs.update(child,total=2,processed=2,success=2))
    first=jobs.submit('faces',face);assert started.wait(2)
    try:
        pending=instance.start(False);root=jobs.get(pending['job_id']);assert root['status']=='queued'
        assert root['resource']=='local-ai' and not root['billable']
        assert instance.start(False)['job_id']==root['id']
        jobs.cancel(root['id']);assert instance.status()['status']=='not_loaded'
        replacement=instance.start(False);assert replacement['job_id']!=root['id'] and calls==[]
    finally:release.set();drained();instance.pool.shutdown()
    assert jobs.get(first['id'])['status']=='completed'
    result=jobs.get(replacement['job_id']);assert result['status']=='completed' and result['success']==2
    assert calls==[False] and instance.status()['status']=='ready'
    stages=jobs.children(result['id'])['items'];assert {j['kind'] for j in stages}=={'semantic-model','semantic-photos'}
    assert all(jobs.get(j['id'])['scope']==result['scope'] for j in stages)
    assert result['scope']['library_id']==client.get('/api/workspace').json()['library_id']


def test_cancelled_model_load_discards_late_model_and_failed_load_releases_slot(client,monkeypatch):
    drained();instance=EmbeddingService();started=Event();release=Event();indexed=[]
    def load(download,child):started.set();assert release.wait(5);return object(),object(),'cpu','synthetic-verified-space',{}
    monkeypatch.setattr(instance,'_load_model',load)
    monkeypatch.setattr(instance,'index',lambda child:indexed.append(child))
    try:
        root=instance.start(False);assert started.wait(2);jobs.cancel(root['job_id']);release.set();drained()
        assert jobs.get(root['job_id'])['status']=='cancelled' and instance.model is None and indexed==[]
        assert instance.status()['status']=='not_loaded'
        def failed(*args):raise ValueError('synthetic damaged model')
        monkeypatch.setattr(instance,'_load_model',failed);bad=instance.start(False);drained()
        assert jobs.get(bad['job_id'])['status']=='failed' and instance.status()['status']=='error'
        monkeypatch.setattr(instance,'_load_model',lambda *args:(object(),object(),'cpu','synthetic-verified-space',{}))
        final=instance.start(False);drained()
        assert jobs.get(final['job_id'])['status']=='completed' and len(indexed)==1
    finally:release.set();drained();instance.pool.shutdown()


def test_real_semantic_index_cancel_keeps_completed_vectors_and_original_hashes(client,image_factory,monkeypatch):
    paths=[image_factory('first.jpg'),image_factory('second.jpg',color=(4,8,12))]
    before=[hashlib.sha256(p.read_bytes()).hexdigest() for p in paths];import_paths(client,paths);drained()
    instance=EmbeddingService();started=Event();release=Event();calls=[]
    class Tensor:
        def float(self):return self
        def cpu(self):return self
        def numpy(self):return np.array([1.,2.,3.],dtype='float32')
    class Inputs(dict):
        def to(self,device):return self
    class Model:
        config=SimpleNamespace(projection_dim=3)
        def get_image_features(self,**inputs):
            calls.append(True)
            if len(calls)==2:started.set();assert release.wait(5)
            return SimpleNamespace(pooler_output=[Tensor()])
    monkeypatch.setitem(sys.modules,'torch',SimpleNamespace(inference_mode=nullcontext,__spec__=ModuleSpec('torch',loader=None)))
    instance.model=Model();instance.model_revision='synthetic-verified-space';instance.processor=lambda **args:Inputs();instance.state['status']='ready'
    try:
        instance.index_if_ready();root_id=instance.task_id;assert started.wait(2)
        child=jobs.children(root_id)['items'][0];assert jobs.get(child['id'])['processed']==1
        jobs.cancel(child['id']);release.set();drained()
        assert jobs.get(root_id)['status']=='cancelled' and jobs.get(root_id)['success']==1
        with Session() as session:
            entries=session.scalars(select(Embedding)).all();assert len(entries)==1
            saved=entries[0].embedding_path;assert instance.load_vector(saved,3) is not None
        instance.index_if_ready();drained()
        assert instance.task_id!=root_id and jobs.get(instance.task_id)['status']=='completed'
        assert jobs.get(instance.task_id)['total']==jobs.get(instance.task_id)['success']==1
        with Session() as session:assert len(session.scalars(select(Embedding)).all())==2
        assert len(calls)==3 and instance.status()['indexed']==2
        assert [hashlib.sha256(p.read_bytes()).hexdigest() for p in paths]==before
    finally:release.set();drained();instance.pool.shutdown()


def test_import_index_requests_coalesce_without_losing_followup(client,monkeypatch):
    drained();instance=EmbeddingService();instance.model=object();instance.state['status']='ready'
    started=Event();release=Event();calls=[]
    def index(child):
        calls.append(child)
        if len(calls)==1:started.set();assert release.wait(5)
    monkeypatch.setattr(instance,'index',index)
    try:
        instance.index_if_ready();root_id=instance.task_id;assert started.wait(2)
        for _ in range(10):instance.index_if_ready()
        assert instance.task_id==root_id
        release.set();drained()
        assert len(calls)==2 and len(set(calls))==1
        assert jobs.get(root_id)['child_count']==1 and instance.status()['status']=='ready'
    finally:release.set();drained();instance.pool.shutdown()


def test_semantic_queue_capacity_does_not_fail_completed_imports_or_run_work(client,monkeypatch):
    drained();instance=EmbeddingService();instance.model=object();instance.state['status']='ready'
    started=Event();release=Event();calls=[]
    def blocked(_id):started.set();assert release.wait(5)
    monkeypatch.setattr(jobs,'MAX_PENDING',1)
    monkeypatch.setattr(instance,'index',lambda child:calls.append(child))
    jobs.submit('export',blocked);assert started.wait(2)
    try:
        instance.index_if_ready();assert instance.task_id is None and calls==[]
        assert not instance._index_queued and instance.status()['status']=='ready'
        assert '队列已满' in instance.status()['error']
        release.set();drained();instance.index_if_ready();drained()
        assert len(calls)==1 and jobs.get(instance.task_id)['status']=='completed'
    finally:release.set();drained();instance.pool.shutdown()
