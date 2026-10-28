import hashlib
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Event
import pytest
from sqlalchemy import select
from backend.app.models import Session,JobRecord,now
from backend.app.services import jobs
from test_library import import_paths,wait_job


def drained():
    deadline=time.monotonic()+5
    while jobs.resources()['pending'] and time.monotonic()<deadline:time.sleep(.01)
    assert jobs.resources()['pending']==0


def test_resource_queues_do_not_starve_export_and_queued_cancel_never_runs(client,monkeypatch):
    drained();started=Event();release=Event();calls=[]
    def blocked(job_id):
        started.set();assert release.wait(5);jobs.update(job_id,total=1,processed=1,success=1)
    first=jobs.submit('import',blocked);assert started.wait(2)
    second=jobs.submit('import',lambda _id:calls.append('must-not-run'))
    assert jobs.get(second['id'])['status']=='queued'
    monkeypatch.setattr(jobs,'MAX_PENDING',3)
    try:
        exported=jobs.submit('export',lambda child:jobs.update(child,total=1,processed=1,success=1))
        result=wait_job(client,exported);assert result['status']=='completed' and not release.is_set()
        # Hold the remaining capacity to verify admission is bounded.
        other_started=Event()
        def hold(_id):other_started.set();assert release.wait(5)
        other=jobs.submit('faces',hold);assert other_started.wait(2)
        with pytest.raises(ValueError,match='队列已满'):jobs.submit('import',lambda _id:None)
        cancelled=jobs.cancel(second['id']);assert cancelled['status']=='cancelled'
        assert jobs.resources()['pending']==2
        replacement=jobs.submit('import',lambda _id:calls.append('replacement'))
        assert jobs.get(replacement['id'])['status']=='queued'
        jobs.cancel(replacement['id'])
        assert client.get('/api/tasks/resources').json()['items'][0]['running']==1
    finally:release.set();drained()
    assert jobs.get(first['id'])['status']=='completed' and calls==[]
    assert jobs.get(second['id'])['status']=='cancelled'
    assert jobs.get(other['id'])['status']=='completed'
    assert jobs.children(exported['id'])['items'][0]['kind']=='export-render'


def test_custom_executor_obeys_shared_resource_limit_and_required_stage_cancel_keeps_results(client,tmp_path):
    drained();started=Event();release=Event();later=[];created=tmp_path/'completed-synthetic.txt'
    with ThreadPoolExecutor(max_workers=2) as executor:
        def work(child):
            created.write_text('already completed result',encoding='utf-8')
            jobs.update(child,total=2,processed=1,success=1,results=[{'file_name':created.name,'url':'/synthetic-result'}])
            started.set();assert release.wait(5);jobs.check(child);later.append('not reached')
        first=jobs.submit('watercolor',work,executor=executor);assert started.wait(2)
        second=jobs.submit('watercolor',lambda _id:later.append('queued'),executor=executor)
        try:
            assert jobs.get(second['id'])['status']=='queued'
            child=jobs.children(first['id'])['items'][0]
            assert jobs.cancel(child['id'])['cancelled']
            assert jobs.get(first['id'])['cancelled']
            jobs.cancel(second['id'])
        finally:release.set();drained()
    result=jobs.get(first['id']);assert result['status']=='cancelled' and result['success']==1
    assert result['results'][0]['file_name']==created.name and created.read_text()=='already completed result'
    assert jobs.get(child['id'])['status']=='cancelled' and later==[]
    root_ids={j['id'] for j in client.get('/api/jobs?summary=true').json()}
    assert first['id'] in root_ids and child['id'] not in root_ids


def test_real_import_stages_keep_counts_source_hash_and_library_scope(client,image_factory):
    original=image_factory();before=hashlib.sha256(original.read_bytes()).hexdigest()
    root=import_paths(client,[original]);drained()
    details=client.get('/api/jobs/'+root['id']).json()
    children=client.get('/api/jobs/'+root['id']+'/children').json()
    assert details['child_count']==3 and details['processed']==details['success']==1
    assert {j['kind'] for j in children['items']}=={'import-scan','import-index','import-preview'}
    assert all(j['status']=='completed' and j['processed']==j['total']==1 for j in children['items'])
    identity=client.get('/api/workspace').json()['library_id']
    assert details['scope']['library_id']==identity
    assert all(jobs.get(j['id'])['scope']['library_id']==identity for j in children['items'])
    assert hashlib.sha256(original.read_bytes()).hexdigest()==before


def test_restart_never_resubmits_cloud_and_preserves_completed_stage_results(client,monkeypatch):
    drained()
    base=dict(total=2,processed=1,success=1,skipped=0,failed=0,current='',errors=[],results=[{'file_name':'saved.png','url':'/saved'}],billable=True,resource='cloud')
    records=[base|dict(id='root-cloud',kind='watercolor-batch',status='running',billing_state='submitted',child_count=2),
             base|dict(id='image-stage',parent_id='root-cloud',kind='watercolor-images',status='completed',billing_state='responded'),
             base|dict(id='title-stage',parent_id='root-cloud',kind='watercolor-titles',status='running',billing_state='submitted')]
    with Session() as session:
        for payload in records:session.add(JobRecord(id=payload['id'],payload=payload,updated_at=now()))
        session.commit()
    def forbidden(*args,**kwargs):raise AssertionError('Recovery must not submit work')
    monkeypatch.setattr(jobs._pools['cloud'],'submit',forbidden)
    jobs.recover()
    assert jobs.get('root-cloud')['status']=='interrupted'
    assert jobs.get('title-stage')['billing_state']=='unknown'
    assert jobs.get('image-stage')['status']=='completed'
    assert jobs.get('root-cloud')['results']==records[0]['results']
    assert jobs.get('root-cloud')['billing_uncertain'] is True
    assert jobs.children('root-cloud')['total']==2


def test_history_prunes_complete_families_without_orphaning_stages(client,monkeypatch):
    drained();monkeypatch.setattr(jobs,'HISTORY_ROOTS',2)
    ids=[]
    def work(root):
        with jobs.stage(root,'synthetic-stage') as child:jobs.update(child,total=1,processed=1,success=1)
    for _ in range(5):
        item=jobs.submit('synthetic-parent',work);ids.append(item['id']);wait_job(client,item);drained()
    with Session() as session:records=session.scalars(select(JobRecord)).all()
    roots={r.id for r in records if not r.payload.get('parent_id')}
    assert roots==set(ids[-2:]) and len(records)==4
    assert all(not r.payload.get('parent_id') or r.payload['parent_id'] in roots for r in records)


def test_cancel_before_submission_never_contacts_provider_and_uncertainty_is_sticky(client,monkeypatch):
    from backend.app.services import art_service
    drained();calls=[]
    monkeypatch.setattr(art_service,'request_api',lambda **kwargs:calls.append(kwargs))
    def cancelled(child):
        jobs.cancel(child)
        art_service.request_for_job(child,json={'model':'synthetic'})
    item=jobs.submit('watercolor',cancelled);drained()
    assert jobs.get(item['id'])['status']=='cancelled'
    assert calls==[] and jobs.get(item['id'])['billing_state']=='not_submitted'
    def uncertain(child):
        jobs.update(child,billing_state='unknown')
        jobs.update(child,billing_state='responded')
    item=jobs.submit('watercolor',uncertain);result=wait_job(client,item);drained()
    assert result['status']=='completed' and result['billing_uncertain'] is True
