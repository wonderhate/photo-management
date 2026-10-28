"""Synthetic preservation regressions for the fixed PC10-16/19/20/25 batch."""
import hashlib
import time
from pathlib import Path
import pytest
from PIL import Image, ImageChops
from backend.tests.test_library import import_paths, wait_job
from backend.tests.test_watermark_drafts import create
from backend.tests.test_art import provider, generate
from backend.app.models import Session, Photo, Artwork
from backend.app.services import jobs, art_service as art, plugin_service


def imported(client, image_factory, name='preserve.jpg', color=(35,90,155)):
    path=image_factory(name,color=color)
    import_paths(client,[path])
    p=next(p for p in client.get('/api/photos').json()['photos'] if p['file_name']==name)
    return path,p


def test_queued_drafts_keep_submission_design_sequence_and_newer_state(client,image_factory,monkeypatch):
    path,p=imported(client,image_factory)
    before=path.read_bytes()
    a=create(client,p['id'],style='classic_frame',theme='white',fields=[],long_edge=500,filename_template='{index}_white')
    b=create(client,p['id'],style='classic_frame',theme='black',fields=[],long_edge=500,filename_template='{index}_black')
    real=jobs.submit;queued=[]
    with monkeypatch.context() as patch:
        patch.setattr(jobs,'submit',lambda *args,**kwargs:queued.append((args,kwargs)) or {'id':'queued'})
        response=client.post('/api/watermark/drafts/batch-export',json={'draft_ids':[a['id'],b['id'],a['id']],'format':'png'})
        assert response.status_code==202
    changed=client.put('/api/watermark/drafts/'+a['id'],json={'revision':a['revision'],'settings_json':a['settings_json']|{'theme':'black'}}).json()
    result=wait_job(client,real(*queued[0][0],**queued[0][1]))
    assert result['success']==2 and result['failed']==0,result
    first,second=result['results']
    assert first['file_name'].startswith('001_white') and second['file_name'].startswith('002_black')
    assert first['draft_revision']==a['revision']
    with Image.open(first['path']) as x,Image.open(second['path']) as y:
        assert sum(x.convert('RGB').getpixel((0,0)))>sum(y.convert('RGB').getpixel((0,0)))+300
    latest=client.get('/api/watermark/drafts/'+a['id']).json()
    assert latest['revision']==changed['revision'] and latest['status']=='draft' and latest['modified_since_export']
    assert path.read_bytes()==before


def test_batch_export_failure_does_not_discard_later_success(client,image_factory):
    a_path,a=imported(client,image_factory,'missing.jpg');b_path,b=imported(client,image_factory,'available.jpg',(80,120,44))
    x=create(client,a['id']);y=create(client,b['id']);before=b_path.read_bytes();a_path.rename(a_path.with_suffix('.moved'))
    result=wait_job(client,client.post('/api/watermark/drafts/batch-export',json={'draft_ids':[x['id'],y['id']],'format':'png'}).json())
    assert result['processed']==2 and result['failed']==1 and result['success']==1,result
    assert result['results'][0]['draft_id']==y['id'] and Path(result['results'][0]['path']).is_file()
    assert b_path.read_bytes()==before


@pytest.mark.parametrize('dimensions,fields,font_size', [
    ((640,420),['camera_model','iso'],1),
    ((1920,1080),['camera_model','iso'],1),
    ((800,1200),['camera_model','iso'],1.5),
    ((640,420),[],1),
])
def test_ambient_signature_changes_only_center_without_layout_shift(dimensions,fields,font_size):
    from backend.app.watermark import ambient_renderer
    from backend.app.schemas import WatermarkOptions
    source=Image.new('RGB',dimensions,(23,67,92));original=source.tobytes()
    options=WatermarkOptions(template='ambient',signature='wonder',signature_style='natural',fields=[*fields,'signature'],font_size=font_size).model_dump()
    photo={'file_name':'synthetic.jpg','camera_model':'Fixture','iso':100}
    a=ambient_renderer.render(source,photo,options)
    b=ambient_renderer.render(source,photo,options|{'fields':fields})
    assert a.size==b.size
    bbox=ImageChops.difference(a,b).getbbox();assert bbox
    assert bbox[0]>=int(a.width*.33) and bbox[2]<=int(a.width*.67)
    assert source.tobytes()==original


def test_fixed_signature_and_licensed_font_sources():
    from backend.app.watermark.signatures import signature_image,ASSETS,FONTS
    options={'signature':'wonder','signature_style':'natural','fields':['signature']}
    first=signature_image(options);second=signature_image(options|{'signature':'different text'})
    assert first.size==second.size and first.tobytes()==second.tobytes()
    assert len(list(ASSETS.glob('*-OFL.txt')))>=len(FONTS)
    assert all((ASSETS/name).is_file() for name in FONTS.values())
    assert 'wonder' in (ASSETS/'README.md').read_text(encoding='utf-8')


def test_changed_source_never_reaches_paid_generation(client,image_factory,provider):
    path,p=imported(client,image_factory);Image.new('RGB',(640,480),'red').save(path)
    job=client.post('/api/art/generate',json={'cloud_confirmed': True, 'photo_id':p['id'],'title_confirmed':True}).json()
    for _ in range(400):
        result=client.get('/api/jobs/'+job['id']).json()
        if result['status'] not in ('queued','running'):break
        time.sleep(.025)
    assert result['status']=='failed' and not provider
    assert result['billing_state']=='not_submitted'


def test_poster_versions_skip_interrupted_bytes_and_pinned_hash_rejects_tamper(client,image_factory,provider):
    path,p=imported(client,image_factory);before=path.read_bytes();work=generate(client,p['id'])
    folder=art.folder_for(work['id']);original=(folder/'poster-1.png').read_bytes()
    draft=client.post('/api/art/works/'+work['id']+'/watermark').json()
    assert draft['source']['artwork_poster_hash']==hashlib.sha256(original).hexdigest()
    (folder/'poster-2.png').write_bytes(b'unfinished synthetic output')
    result=client.put('/api/art/works/'+work['id'],json={'revision':1,'layout':work['layout']|{'paper':.8}})
    assert result.status_code==200,result.text
    assert result.json()['revision']==3 and (folder/'poster-2.png').read_bytes()==b'unfinished synthetic output'
    assert client.get('/api/art/works/'+work['id']+'/poster?revision=1').content==original
    assert client.get('/api/art/works/'+work['id']+'/poster?revision=99').status_code==404
    (folder/'poster-1.png').write_bytes(b'synthetic corruption')
    assert client.post('/api/watermark/drafts/'+draft['id']+'/export',json={}).status_code==400
    assert len(provider)==1 and path.read_bytes()==before


def test_batch_keeps_unknown_item_and_success_without_retry(client,image_factory,provider,monkeypatch):
    _,a=imported(client,image_factory,'first.jpg');_,b=imported(client,image_factory,'second.jpg',(85,35,70))
    original=art.request_api;calls=[]
    def request(**kwargs):
        calls.append(kwargs)
        if len(calls)==1:raise ValueError('Synthetic timeout; billing unknown')
        return original(**kwargs)
    monkeypatch.setattr(art,'request_api',request)
    result=wait_job(client,client.post('/api/art/batch',json={'cloud_confirmed': True, 'photo_ids':[a['id'],b['id']]}).json())
    assert result['processed']==2 and result['success']==1 and result['failed']==1,result
    assert len(calls)==2 and result['billing_uncertain']
    assert result['results'][0]['billing_state']=='unknown' and result['results'][1]['billing_state']=='responded'
    assert result['results'][1]['photo_id']==b['id'] and client.get('/api/art/works/'+result['results'][1]['artwork_id']).status_code==200


def test_automatic_title_cannot_overwrite_a_manual_layout_saved_elsewhere(client,image_factory,provider,monkeypatch):
    _,p=imported(client,image_factory);original=art.suggest_titles
    def suggest(job_id,payload,model,**kwargs):
        result=original(job_id,payload,model,**kwargs)
        from sqlalchemy import select
        from backend.app.art_schemas import ArtLayout
        with art.lock,Session() as session:
            work=session.scalar(select(Artwork).where(Artwork.photo_id==p['id']))
            art.update_layout(session,work,ArtLayout(title='Manual decision'))
        return result
    monkeypatch.setattr(art,'suggest_titles',suggest)
    result=wait_job(client,client.post('/api/art/batch',json={'cloud_confirmed': True, 'photo_ids':[p['id']],'generate_titles':True}).json())
    assert result['success']==1 and result['results'][0]['title_status']=='failed'
    work=client.get('/api/art/works/'+result['results'][0]['artwork_id']).json()
    assert work['layout']['title']=='Manual decision' and work['revision']==2 and len(provider)==2


def test_watermark_cancel_retains_published_result_and_skips_remaining(client,image_factory,monkeypatch):
    from backend.app.services import watermark_service
    path,p=imported(client,image_factory);before=path.read_bytes()
    a=create(client,p['id']);b=create(client,p['id']);original=watermark_service.export_source;calls=[]
    def export(*args,**kwargs):
        result=original(*args,**kwargs);calls.append(result)
        jobs.cancel(kwargs['job_id'])
        return result
    monkeypatch.setattr(watermark_service,'export_source',export)
    job=client.post('/api/watermark/drafts/batch-export',json={'draft_ids':[a['id'],b['id']]}).json()
    for _ in range(400):
        state=client.get('/api/jobs/'+job['id']).json()
        if state['status'] not in ('queued','running'):break
        time.sleep(.025)
    assert state['status']=='cancelled' and state['success']==state['processed']==1
    assert len(calls)==1 and len(state['results'])==1 and Path(state['results'][0]['path']).is_file()
    assert path.read_bytes()==before


def test_plugin_reads_own_transaction_and_manual_rating_survives_failure(client,image_factory,tmp_path,monkeypatch):
    path,p=imported(client,image_factory);before=path.read_bytes();monkeypatch.setattr(plugin_service,'PLUGINS',tmp_path)
    script=tmp_path/'preserve.py'
    body=f'''def run(ctx, stars=3):
 ctx.message('start')
 ctx.update({p['id']!r}, rating=stars, add_tags=['preserved'])
 assert next(p for p in ctx.photos() if p['id']=={p['id']!r})['rating']==stars
 return ctx.api_version
'''
    script.write_text(body,encoding='utf-8')
    result=plugin_service.run('preserve',{'stars':4})
    assert result=={'ok':True,'result':'1','log':['start']}
    with Session() as session:assert session.get(Photo,p['id']).rating_source=='manual'
    script.write_text(body.replace('return ctx.api_version',"raise ValueError('rollback')"),encoding='utf-8')
    with pytest.raises(ValueError,match='rollback'):plugin_service.run('preserve',{'stars':1})
    assert client.get('/api/photos/'+p['id']).json()['rating']==4 and path.read_bytes()==before
