"""Cloud boundaries use MockTransport only; no real upload or paid request."""
import json
import time
from threading import Event
import httpx
import pytest
from backend.app.models import Session,JobRecord
from backend.app.services import art_service as art,art_credentials,jobs
from backend.tests.test_library import import_paths,wait_job


@pytest.mark.parametrize('endpoint,body',[
    ('generate',{'photo_id':'synthetic','title_confirmed':True}),
    ('titles',{'photo_id':'synthetic'}),
    ('batch',{'photo_ids':['synthetic']}),
])
@pytest.mark.parametrize('consent',[None,False,1,'true'])
def test_unconfirmed_native_watercolor_never_accesses_provider(client,monkeypatch,endpoint,body,consent):
    calls=[]
    monkeypatch.setattr(art,'request_api',lambda **kwargs:calls.append(kwargs))
    monkeypatch.setattr(art_credentials,'get_key',lambda:pytest.fail('Credential access before explicit confirmation'))
    payload=body if consent is None else body|{'cloud_confirmed':consent}
    assert client.post('/api/art/'+endpoint,json=payload).status_code==422
    assert calls==[]


def test_approved_key_is_frozen_in_memory_and_not_in_job(client,image_factory,monkeypatch):
    original=image_factory('approved-key.jpg');before=original.read_bytes();import_paths(client,[original])
    photo=client.get('/api/photos').json()['photos'][0]
    entered,release=Event(),Event();seen=[]
    monkeypatch.setenv('DASHSCOPE_API_KEY','synthetic-approved-account')
    def titles(job_id,payload,model,**kwargs):
        entered.set();assert release.wait(10)
        seen.append(art._authorized_key.get())
        assert art_credentials.get_key()=='synthetic-new-account'
        jobs.update(job_id,processed=1,success=1)
    monkeypatch.setattr(art,'suggest_titles',titles)
    response=client.post('/api/art/titles',json={'photo_id':photo['id'],'cloud_confirmed':True})
    assert response.status_code==202
    try:
        assert entered.wait(5)
        monkeypatch.setenv('DASHSCOPE_API_KEY','synthetic-new-account')
    finally:release.set()
    job=wait_job(client,response.json())
    assert seen==['synthetic-approved-account']
    with Session() as session:stored=session.get(JobRecord,job['id']).payload
    assert 'synthetic-approved-account' not in json.dumps(stored)
    assert original.read_bytes()==before


@pytest.mark.parametrize('header_id',['fixture-request-42','synthetic-private-key'])
def test_uncertain_request_retains_safe_receipt_without_retry(client,monkeypatch,header_id):
    calls=[];secret='synthetic-private-key';monkeypatch.setenv('DASHSCOPE_API_KEY',secret)
    class BrokenBody(httpx.SyncByteStream):
        def __iter__(self):
            yield b'{'
            raise httpx.ReadTimeout('Synthetic disconnected response')
    def handler(request):
        calls.append(request.method)
        return httpx.Response(200,headers={'x-request-id':header_id},stream=BrokenBody())
    real=httpx.Client
    monkeypatch.setattr(httpx,'Client',lambda **kw:real(transport=httpx.MockTransport(handler),**kw))
    queued=jobs.submit('watercolor',lambda id:art.request_for_job(id,json={'model':'qwen-image-3.0'}))
    for _ in range(400):
        job=client.get('/api/jobs/'+queued['id']).json()
        if job['status']=='failed':break
        time.sleep(.025)
    assert job['status']=='failed' and job['billing_state']=='unknown' and job['billing_uncertain']
    expected='' if header_id==secret else header_id
    assert job['request_id']==expected and calls==['POST']
    jobs.recover()
    recovered=client.get('/api/jobs/'+job['id']).json()
    assert recovered['request_id']==expected and recovered['billing_state']=='unknown'
    assert secret not in json.dumps(recovered) and calls==['POST']
