"""Synthetic-only domestic AI integration; never contact a paid provider."""
import base64
import hashlib
import json
from io import BytesIO
import pytest
from PIL import Image
from backend.app.config import DATA
from backend.app.models import Session,AIProfile,AIResult
from backend.app.services import ai_studio as studio,ai_protocol,jobs
from backend.app.ai_schemas import Profile,validate_stored_result
from backend.tests.test_library import import_paths,wait_job
from backend.migrate_storage import migrate

KEY='synthetic-ai-account-key-only'
OPTIONS=dict(language='both',tag_count=2,caption_length=30,ocr=True,place_guess=True)
ANNOTATION=dict(version=1,caption_zh='可见山和湖',caption_en='Mountains and a lake',tags=[{'zh':'山','en':'Mountain'},{'zh':'湖','en':'Lake'}],detected_text='TEST 42',place_guess={'name':'示例湖','confidence':.4,'evidence':'Only a visual hypothesis'})


def profile(client,**changes):
    body=dict(name='Synthetic Qwen',provider='qwen-cn',region='cn-beijing',workspace='',image_model='qwen-image-3.0',vision_model='qwen3-vl-plus',revision=0,api_key=KEY)|changes
    response=client.post('/api/ai/profiles',json=body)
    assert response.status_code==201,response.text
    return response.json()


def imported(client,image_factory,name='ai-source.jpg'):
    path=image_factory(name,day=28 if 'later' in name else 29);job=import_paths(client,[path])
    photo=next(p for p in client.get('/api/photos?count_mode=file').json()['photos'] if p['file_name']==name)
    return path,photo,job


@pytest.fixture
def provider(monkeypatch):
    calls=[]
    def request(job_id,p,key,body):
        assert key==KEY
        calls.append((p,body));jobs.mark_submitted(job_id);jobs.update(job_id,billing_state='responded',request_id='fixture-'+str(len(calls)))
        if p['vision_model'] and body['model']==p['vision_model']:
            image=body['input']['messages'][0]['content'][0]['image']
            with Image.open(BytesIO(base64.b64decode(image.split(',')[1]))) as clean:assert not clean.getexif() and max(clean.size)<=1536
            text=json.dumps(ANNOTATION,ensure_ascii=False)
            return {'output':{'choices':[{'message':{'content':[{'text':text}]}}]}},'fixture-'+str(len(calls))
        im=Image.new('RGB',(24,16),'white');im.putpixel((5,5),(0,0,0));out=BytesIO();im.save(out,'PNG')
        value=base64.b64encode(out.getvalue()).decode()
        return ({'data':[{'b64_json':value}]} if p['provider']=='ark-cn' else {'output':{'choices':[{'message':{'content':[{'image':'data:image/png;base64,'+value}]}}]}}),'fixture-'+str(len(calls))
    monkeypatch.setattr(studio,'request',request)
    return calls


def scope(client,p,**selection):
    r=client.post('/api/ai/annotation-scope',json={'profile_id':p['id'],'options':OPTIONS,**selection})
    assert r.status_code==200,r.text
    return r.json()


def annotate(client,s):
    r=client.post('/api/ai/annotate',json={'token':s['token'],'count':s['count'],'confirmed':True})
    assert r.status_code==202,r.text
    return wait_job(client,r.json())


def test_authorization_scope_import_and_manual_priority(client,image_factory,provider):
    path,p,first=imported(client,image_factory);before=hashlib.sha256(path.read_bytes()).hexdigest()
    account=profile(client)
    client.patch('/api/photos/'+p['id'],json={'user_description':'人工说明','tags':['Manual']})
    s=scope(client,account,import_job_id=first['id'])
    assert s['photos']==[{'id':p['id'],'name':p['file_name']}] and not provider
    assert client.post('/api/ai/annotate',json={'token':s['token'],'count':s['count'],'confirmed':False}).status_code==422
    assert client.post('/api/ai/annotate',json={'token':s['token'],'count':2,'confirmed':True}).status_code==400
    job=annotate(client,s);assert job['success']==1 and len(provider)==1
    assert client.post('/api/ai/annotate',json={'token':s['token'],'count':1,'confirmed':True}).status_code==400
    result=client.get('/api/ai/results/'+job['results'][0]['result_id']).json()
    fresh=client.get('/api/photos/'+p['id']).json()
    assert fresh['description']=='人工说明' and fresh['tag_origins']['Manual']=='user'
    assert {'山','Mountain','湖','Lake'}<=set(fresh['tags'])
    for field,value in [('ai_caption','Mountains'),('detected_text','TEST 42'),('tag','Mountain')]:
        query={'version':1,'root':{'field':field,'op':'eq' if field=='tag' else 'icontains','value':value}}
        assert p['id'] in client.get('/api/photos/ids',params={'count_mode':'file','query':json.dumps(query)}).json()['ids']
    location=client.get('/api/locations/photos/'+p['id']).json()
    reviewed=client.post('/api/ai/results/'+result['id']+'/place-review',json={'revision':result['revision'],'status':'accepted'})
    assert reviewed.status_code==200 and reviewed.json()['place_review']['status']=='accepted'
    assert client.get('/api/locations/photos/'+p['id']).json()==location
    assert client.post('/api/ai/results/'+result['id']+'/place-review',json={'revision':result['revision'],'status':'rejected'}).status_code==400
    _,other,later=imported(client,image_factory,'ai-later.jpg')
    recent=scope(client,account,import_job_id=later['id'])
    assert [x['id'] for x in recent['photos']]==[other['id']] and len(provider)==1
    assert hashlib.sha256(path.read_bytes()).hexdigest()==before


def test_profile_identity_keys_and_transfer_are_explicit(client,provider):
    p=profile(client);assert KEY not in json.dumps(p) and not provider
    assert client.post('/api/ai/profile-transfer/export',json={'confirmed':False,'profile_ids':[p['id']]}).status_code==422
    bundle=client.post('/api/ai/profile-transfer/export',json={'confirmed':True,'profile_ids':[p['id']]})
    assert bundle.status_code==200 and bundle.headers['cache-control']=='no-store'
    assert bundle.json()[0]['api_key']==KEY
    workspace=client.get('/api/workspace').json()
    transferred=client.post('/api/workspace/settings-transfer',json={'library_id':workspace['library_id'],'gallery':{'grid':220},'accounts':bundle.json()})
    assert transferred.status_code==200,transferred.text
    all_profiles=client.get('/api/ai/profiles').json();assert len(all_profiles)==2 and all(x['configured'] for x in all_profiles)
    r=client.put('/api/ai/profiles/'+p['id'],json={'name':p['name'],'provider':'ark-cn','region':'cn-beijing','workspace':'','image_model':'doubao-seedream-4-0-250828','vision_model':'','revision':p['revision']})
    assert r.status_code==200 and not r.json()['configured'] and not provider
    bad=client.post('/api/ai/profiles',json={'api_key':KEY,'provider':'unsupported'})
    assert bad.status_code==422 and KEY not in bad.text
    before=client.get('/api/workspace').json()
    broken=bundle.json();broken[0]['api_key']='bad key'
    r=client.post('/api/workspace/settings-transfer',json={'library_id':workspace['library_id'],'gallery':{'grid':250},'accounts':broken})
    assert r.status_code==422 and client.get('/api/workspace').json()==before


def test_invalid_annotation_can_be_repaired_without_cloud_retry(client,image_factory,monkeypatch):
    path,p,_=imported(client,image_factory);account=profile(client);calls=[]
    def malformed(job_id,*args):
        calls.append(job_id);jobs.mark_submitted(job_id);jobs.update(job_id,billing_state='responded')
        return {'output':{'choices':[{'message':{'content':[{'text':'bad JSON '+KEY}]}}]}},'broken-format'
    monkeypatch.setattr(studio,'request',malformed)
    job=annotate(client,scope(client,account,photo_ids=[p['id']]))
    assert job['failed']==1 and len(calls)==1
    r=client.get('/api/ai/results/'+job['results'][0]['result_id']).json()
    assert not r['applied'] and KEY not in r['repair_text']
    repaired=client.post('/api/ai/results/'+r['id']+'/repair',json={'revision':r['revision'],'result':ANNOTATION})
    assert repaired.status_code==200 and repaired.json()['applied'] and len(calls)==1
    assert client.post('/api/ai/results/'+r['id']+'/repair',json={'revision':r['revision'],'result':ANNOTATION}).status_code==400


def test_handwriting_and_history_export_are_local_and_originals_immutable(client,image_factory,provider,tmp_path):
    path,p,_=imported(client,image_factory);before=hashlib.sha256(path.read_bytes()).hexdigest();account=profile(client)
    payload={'profile_id':account['id'],'profile_revision':1,'confirmed':True,'kind':'handwriting','text':'测试文字','prompt':'','preset':'custom','photo_id':p['id'],'source_hash':p['file_hash']}
    def generate(body):
        r=client.post('/api/ai/create',json=body);assert r.status_code==202,r.text
        job=wait_job(client,r.json());assert job['success']==1,job
        return client.get('/api/ai/results/'+job['result_id']).json()
    first=generate(payload);second=generate(payload|{'parent_id':first['id']})
    original=(DATA/'ai-studio'/first['id']/'image.png').read_bytes()
    with Image.open(BytesIO(original)) as im:assert im.mode=='RGBA' and im.getpixel((0,0))[3]==0 and im.getpixel((5,5))[3]==255
    for color in ['#ff0000','#00ff00']:
        r=client.post('/api/ai/results/'+first['id']+'/handwriting-export',json={'verified_text':True,'color':color,'x':.2,'y':.7,'scale':.5})
        assert r.status_code==200,r.text
    assert len(provider)==2 and (DATA/'ai-studio'/first['id']/'image.png').read_bytes()==original
    graph=client.get('/api/assets/graph',params={'kind':'ai-result','id':second['id']}).json()
    assert any(e['kind']=='ai-version' for e in graph['links'])
    target=tmp_path/'copied-ai-library';migrate(DATA,target)
    assert (target/'ai-studio'/first['id']/'image.png').read_bytes()==original
    assert client.delete('/api/ai/results/'+second['id']).status_code==200
    assert hashlib.sha256(path.read_bytes()).hexdigest()==before and len(provider)==2


def test_protocols_and_normalization_are_bounded_and_do_not_switch_providers():
    q=Profile(name='q',provider='qwen-cn',image_model='qwen-image-3.0',vision_model='qwen3-vl-plus').model_dump(exclude={'api_key','clear_key'})
    ark=Profile(name='a',provider='ark-cn',image_model='doubao-seedream-4-5-251128').model_dump(exclude={'api_key','clear_key'})
    assert ai_protocol.endpoint(q).startswith('https://dashscope.aliyuncs.com/')
    assert ai_protocol.endpoint(q|{'workspace':'example'}).startswith('https://example.cn-beijing.maas.aliyuncs.com/')
    assert ai_protocol.image_request(ark,'text')['size']=='2K'
    assert 'input' not in ai_protocol.image_request(ark,'text')
    with pytest.raises(ValueError):ai_protocol.annotation_request(ark,'image',OPTIONS)
    with pytest.raises(ValueError):ai_protocol.image_request(q|{'image_model':'qwen-image-edit-plus'},'text')
    normalized=ai_protocol.normalized_annotation(ANNOTATION|{'tags':[{'zh':' 山 ','en':'Ｍountain'},{'zh':'山','en':'mountain'}],'caption_en':'x'*100},OPTIONS)
    assert len(normalized['tags'])==1 and len(normalized['caption_en'])==30
    for change in [{'version':2},{'gps':[1,2]},{'place_guess':{'name':'x','confidence':True,'evidence':'x'}},{'tags':[{'zh':'x'}]}]:
        with pytest.raises(ValueError):ai_protocol.normalized_annotation(ANNOTATION|change,OPTIONS)


def test_timeout_is_one_billable_post_and_unknown_without_retry(monkeypatch):
    calls=[];updates=[]
    class Offline:
        def __init__(self,**options):assert options['follow_redirects'] is False
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def stream(self,*args,**kwargs):calls.append(args);raise TimeoutError('never expose '+KEY)
    monkeypatch.setattr(studio.httpx,'Client',Offline)
    monkeypatch.setattr(jobs,'mark_submitted',lambda id:updates.append('submitted'))
    monkeypatch.setattr(jobs,'update',lambda id,**kw:updates.append(kw))
    with pytest.raises(ValueError) as error:studio.request('job',{'provider':'ark-cn'},KEY,{})
    assert KEY not in str(error.value) and len(calls)==1 and updates==['submitted',{'billing_state':'unknown'}]



def test_scope_reconfiguration_and_changed_source_are_rejected_before_upload(client,image_factory,provider):
    path,p,_=imported(client,image_factory);account=profile(client);s=scope(client,account,photo_ids=[p['id']])
    body={k:account[k] for k in ('name','provider','region','workspace','image_model','vision_model','revision')}
    r=client.put('/api/ai/profiles/'+account['id'],json=body|{'name':'New profile revision'})
    assert r.status_code==200
    rejected=client.post('/api/ai/annotate',json={'token':s['token'],'count':1,'confirmed':True})
    assert rejected.status_code==400 and not provider
    s=scope(client,r.json(),photo_ids=[p['id']]);path.write_bytes(b'changed synthetic source')
    job=annotate(client,s);assert job['failed']==1 and not provider
    assert job['results'][0]['billing_state']=='not_submitted'


def test_cancel_preserves_completed_annotations_and_skips_remaining_paid_calls(client,image_factory,provider,monkeypatch):
    from threading import Event
    import time
    path,p,_=imported(client,image_factory);other,q,_=imported(client,image_factory,'ai-later.jpg');account=profile(client)
    hashes=[hashlib.sha256(x.read_bytes()).hexdigest() for x in (path,other)]
    entered=Event();release=Event();original=studio.sanitized_photo;calls=[]
    def held(*args):
        calls.append(args)
        if len(calls)==2:entered.set();assert release.wait(10)
        return original(*args)
    monkeypatch.setattr(studio,'sanitized_photo',held)
    snapshot=scope(client,account,photo_ids=[p['id'],q['id']])
    response=client.post('/api/ai/annotate',json={'token':snapshot['token'],'count':2,'confirmed':True});assert response.status_code==202
    try:
        assert entered.wait(8)
        cancelled=client.post('/api/jobs/'+response.json()['id']+'/cancel');assert cancelled.status_code==200
    finally:release.set()
    for _ in range(200):
        job=client.get('/api/jobs/'+response.json()['id']).json()
        if job['status'] not in ('queued','running'):break
        time.sleep(.025)
    assert job['status']=='cancelled' and job['success']==1 and len(provider)==1
    result=client.get('/api/ai/results/'+job['results'][0]['result_id']).json();assert result['applied']
    assert [hashlib.sha256(x.read_bytes()).hexdigest() for x in (path,other)]==hashes


def test_ai_history_merge_preserves_records_and_rejects_conflicting_versions(client,image_factory,provider,tmp_path):
    import sqlite3
    from backend.app.migrations import backup_database
    from backend.library_maintenance import merge_libraries
    path,p,_=imported(client,image_factory);account=profile(client)
    first=annotate(client,scope(client,account,photo_ids=[p['id']]))
    target=backup_database(DATA/'library.db',tmp_path/'target.db')
    _,q,_=imported(client,image_factory,'ai-later.jpg');second=annotate(client,scope(client,account,photo_ids=[q['id']]))
    stage=tmp_path/'stage.db';merge_libraries(target,DATA/'library.db',stage,DATA,tmp_path/'merged-files')
    with sqlite3.connect(stage) as db:
        assert db.execute('SELECT COUNT(*) FROM ai_profiles').fetchone()[0]==1
        assert {r[0] for r in db.execute('SELECT id FROM ai_results')}=={first['results'][0]['result_id'],second['results'][0]['result_id']}
    before=target.read_bytes()
    with Session() as session:
        row=session.get(AIResult,first['results'][0]['result_id']);row.record=row.record|{'revision':row.record['revision']+1};session.commit()
    with pytest.raises(ValueError,match='Conflicting AI history'):
        merge_libraries(target,DATA/'library.db',tmp_path/'conflict-stage.db',DATA,tmp_path/'merged-files')
    assert target.read_bytes()==before
