"""Loopback, approvals and immutable sources; no cloud request is made."""
from hashlib import sha256
import time
import pytest
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app import runtime_control
from backend.app.services import mcp_service as agent,jobs
from backend.app.mcp_schemas import catalog,parse
from backend.tests.test_library import import_paths,wait_job

@pytest.fixture
def local(client):
    agent.configure(False,['read'])
    with TestClient(app,base_url='http://127.0.0.1',client=('127.0.0.1',5999)) as c:
        yield c
    agent.configure(False,['read'])

def headers():return {'Sec-Fetch-Site':'same-origin','X-PhotoCollection-Session':runtime_control.session_id,'X-PhotoCollection-Library':runtime_control.library_id}
def start(c,scopes=('read','write')):
    r=c.put('/api/agent/settings',headers=headers(),json={'enabled':True,'scopes':list(scopes)})
    assert r.status_code==200,r.text
    token=r.json()['token'];h={'Authorization':'Bearer '+token,'Accept':'application/json, text/event-stream'}
    r=c.post('/mcp',headers=h,json={'jsonrpc':'2.0','id':1,'method':'initialize','params':{'protocolVersion':'2025-06-18','clientInfo':{'name':'fixture','version':'1'},'capabilities':{}}})
    assert r.status_code==200,r.text
    h.update({'Mcp-Session-Id':r.headers['Mcp-Session-Id'],'MCP-Protocol-Version':'2025-06-18'})
    assert c.post('/mcp',headers=h,json={'jsonrpc':'2.0','method':'notifications/initialized'}).status_code==202
    return h
def call(c,h,name,args):
    r=c.post('/mcp',headers=h,json={'jsonrpc':'2.0','id':2,'method':'tools/call','params':{'name':name,'arguments':args}})
    assert r.status_code==200,r.text
    import json
    result=r.json()['result']
    if result['isError']:return {'isError':True,'message':result['content'][0]['text']}
    return json.loads(result['content'][0]['text'])
def decision(c,r,approved=True,paid=False):
    return c.post('/api/agent/requests/'+r['job_id']+'/approval',headers=headers(),json={'digest':jobs.get(r['job_id'])['review_digest'],'approved':approved,'paid_consent':paid})
def photo(c,image_factory):
    path=image_factory('agent-original.jpg');import_paths(c,[path]);p=c.get('/api/photos?count_mode=file').json()['photos'][0]
    return path,p

def test_37_strict_families_and_disabled_defaults(local):
    assert len(catalog())==37 and len({t['name'] for t in catalog()})==37
    assert all(t['inputSchema']['additionalProperties'] is False for t in catalog())
    assert local.post('/mcp',json={}).status_code==401
    assert local.get('/api/agent/settings',headers=headers()).json()['enabled'] is False
    for tool in catalog():
        with pytest.raises(ValueError):parse(tool['name'],{'execute':'arbitrary code'})
    with pytest.raises(ValueError):parse('update_assets',{'catalog_id':'test','photo_ids':['a'],'patch':{'rating':True}})
    for size in (0,1001,1024,True):
        with pytest.raises(ValueError):parse('add_text',{'catalog_id':'test','photo_ids':['a'],'text':'Boundary','size':size})
    for size in (1,1000):
        assert parse('add_text',{'catalog_id':'test','photo_ids':['a'],'text':'Boundary','size':size})['size']==size

def test_transport_token_origin_host_and_body_limits(local):
    h=start(local)
    assert local.get('/mcp',headers=h).status_code==405
    assert local.post('/mcp',headers=h|{'Host':'evil.example'},json={}).status_code==400
    assert local.post('/mcp',headers=h|{'Origin':'https://evil.example'},json={}).status_code==403
    assert local.post('/mcp',headers=h|{'Forwarded':'for=127.0.0.1'},json={}).status_code==403
    assert local.post('/mcp',headers=h|{'Authorization':'Bearer incorrect'},json={}).status_code==401
    assert local.post('/mcp',headers=h|{'Content-Type':'application/json'},content=' '*262145).status_code==413
    assert local.put('/api/agent/settings',headers=headers()|{'Authorization':h['Authorization']},json={'enabled':False,'scopes':['read']}).status_code==403
    assert local.post('/mcp',headers=h,json=[]).json()['error']['code']==-32600
    r=local.post('/mcp',headers=h,json={'jsonrpc':'2.0','id':3,'method':'tools/list'}).json()
    assert len(r['result']['tools'])==37
    old=h.copy();start(local)
    assert local.get('/mcp',headers=old).status_code==401

def test_writes_are_visible_single_use_and_original_read_only(local,image_factory):
    path,p=photo(local,image_factory);original=sha256(path.read_bytes()).hexdigest();h=start(local)
    args={'catalog_id':runtime_control.library_id,'photo_ids':[p['id']],'patch':{'rating':4}}
    r=call(local,h,'update_assets',args)
    assert r['status']=='awaiting_approval' and local.get('/api/photos/'+p['id']).json()['rating']!=4
    assert jobs.get(r['job_id'])['actor']=='agent'
    assert decision(local,r).status_code==200
    done=wait_job(local,jobs.get(r['job_id']));assert done['status']=='completed'
    assert local.get('/api/photos/'+p['id']).json()['rating']==4
    assert decision(local,r).status_code==400
    assert sha256(path.read_bytes()).hexdigest()==original
    hidden=call(local,h,'delete_assets',{'catalog_id':runtime_control.library_id,'photo_ids':[p['id']]})
    assert decision(local,hidden).status_code==200
    wait_job(local,jobs.get(hidden['job_id']));assert path.exists() and sha256(path.read_bytes()).hexdigest()==original

def test_selection_version_and_catalog_never_drift(local,image_factory):
    _,p=photo(local,image_factory);h=start(local);cid=runtime_control.library_id
    selected={'catalog_id':cid,'window_id':'fixture-window','photo_ids':[p['id']],'total_count':1,'view':'photos','focused':True}
    assert local.post('/api/agent/selection',headers=headers(),json=selected).status_code==200
    chosen=call(local,h,'get_selection',{'catalog_id':cid})['result']
    r=call(local,h,'update_assets',{'catalog_id':cid,'selection_version':chosen['selection_version'],'patch':{'favorite':True}})
    local.post('/api/agent/selection',headers=headers(),json=selected|{'photo_ids':[],'total_count':0})
    assert decision(local,r).status_code==400
    assert not local.get('/api/photos/'+p['id']).json()['favorite']
    assert call(local,h,'get_selection',{'catalog_id':'other'})['isError']
    assert call(local,h,'update_assets',{'catalog_id':cid,'selection_version':chosen['selection_version'],'patch':{'favorite':True}})['isError']
    local.post('/api/agent/selection',headers=headers(),json=selected|{'focused':False})
    assert call(local,h,'get_selection',{'catalog_id':cid})['isError']

def test_changed_metadata_and_paid_scope_require_new_review(local,image_factory):
    _,p=photo(local,image_factory);h=start(local);cid=runtime_control.library_id
    r=call(local,h,'update_assets',{'catalog_id':cid,'photo_ids':[p['id']],'patch':{'rating':3}})
    local.patch('/api/photos/'+p['id'],json={'user_description':'changed after review'})
    assert decision(local,r).status_code==400
    paid=call(local,h,'repaint_asset',{'catalog_id':cid,'photo_id':p['id'],'profile_id':'missing','profile_revision':1,'source_hash':p['file_hash']})
    assert paid['isError'] and all(j.get('billing_state') in (None,'not_submitted') for j in jobs.recent())

def test_renderer_claim_is_exclusive_cancellable_and_not_replayed(local,image_factory):
    _,p=photo(local,image_factory);h=start(local);cid=runtime_control.library_id
    selected={'catalog_id':cid,'window_id':'fixture-window','photo_ids':[p['id']],'total_count':1,'view':'photos','focused':True}
    local.post('/api/agent/selection',headers=headers(),json=selected)
    r=call(local,h,'export_assets',{'catalog_id':cid,'photo_ids':[p['id']]});assert decision(local,r).status_code==200
    url='/api/agent/requests/'+r['job_id']
    claimed=local.post(url+'/claim',headers=headers(),json={'window_id':'fixture-window'})
    assert claimed.status_code==200,claimed.text
    assert local.post(url+'/claim',headers=headers(),json={'window_id':'fixture-window'}).status_code==400
    token=claimed.json()['claim_token'];assert token not in str(call(local,h,'get_job_status',{'catalog_id':cid,'job_id':r['job_id']}))
    local.post('/api/jobs/'+r['job_id']+'/cancel')
    assert local.post(url+'/progress',headers=headers(),json={'claim_token':token,'processed':0,'total':1}).json()['cancelled']
    assert local.post(url+'/finish',headers=headers(),json={'claim_token':token,'result':{}}).json()['status']=='cancelled'
    assert local.post(url+'/finish',headers=headers(),json={'claim_token':token,'result':{}}).status_code==400

def test_session_recovery_never_resumes_approval_or_paid_work(local):
    job=jobs.external('agent-request',billable=True,tool='repaint_asset')
    jobs.recover()
    assert jobs.get(job['id'])['status']=='interrupted'
    assert jobs.get(job['id'])['billing_state']=='not_submitted'

def test_read_tool_adapters_use_real_library_services(local,image_factory):
    path,p=photo(local,image_factory);h=start(local);cid=runtime_control.library_id
    other=image_factory('unrelated.jpg',color=(30,80,110))
    import_paths(local,[other])
    album=local.post('/api/albums',json={'name':'MCP fixture','photo_ids':[p['id']]}).json()
    cases=[('get_catalog_info',{}),('search_assets',{'text':'agent-original','count_mode':'file'}),
        ('get_asset',{'photo_id':p['id']}),('list_tags',{}),('browse_map',{}),
        ('list_active_jobs',{}),('manage_collections',{'action':'list'}),
        ('manage_collections',{'action':'get','collection_id':album['id']}),
        ('raw_pairing',{'action':'list_pending','photo_id':p['id']}),
        ('list_people',{}),('list_lookalikes',{}),('get_editor_capabilities',{}),
        ('maintain_library',{'action':'list_watched_dirs'})]
    for name,params in cases:
        result=call(local,h,name,params if name=='get_catalog_info' else {'catalog_id':cid,**params})
        assert not result.get('isError'),(name,result)
        assert jobs.get(result['job_id'])['status']=='completed'
        if name=='search_assets':assert [v['id'] for v in result['result']['items']]==[p['id']]
        assert str(path) not in str(result)
    assert call(local,h,'search_assets',{'catalog_id':cid,'text':'no-such-image','count_mode':'file'})['result']['total']==0
