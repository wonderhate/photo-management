from pathlib import Path
from PIL import Image
from backend.tests.test_library import import_paths, wait_job
from backend.app.config import DATA, EXPORTS
from backend.app.models import engine, initialize

def create(client, photo_id, **options):
    response = client.post('/api/watermark/drafts', json={'photo_id':photo_id,'settings_json':options})
    assert response.status_code == 201, response.text
    return response.json()

def test_persistent_draft_duplicate_preview_and_safe_delete(client,image_factory):
    path = image_factory()
    import_paths(client,[path])
    photo = client.get('/api/photos').json()['photos'][0]
    exports_before = set(EXPORTS.glob('*'))
    d = create(client, photo['id'], signature='摄影署名',fields=['signature'],border=.1,template='ambient',blur=.15)
    assert d['capture_group_id'] == photo['capture_group_id']
    assert set(EXPORTS.glob('*')) == exports_before
    preview = Path(d['preview_path'])
    assert preview.parent == DATA/'watermark_previews'
    with Image.open(preview) as image:
        assert image.format == 'WEBP' and max(image.size) <= 1200
    assert client.get(d['preview_url']).status_code == 200
    engine.dispose();initialize()
    restored = client.get('/api/watermark/drafts/'+d['id']).json()
    assert restored['settings_json'] == d['settings_json']
    renamed = client.put('/api/watermark/drafts/'+d['id'],json={'revision':d['revision'],'name':'我的作品'}).json()
    assert renamed['preview_path'] == d['preview_path']
    ready = client.patch('/api/watermark/drafts/'+d['id']+'/status',json={'status':'ready'}).json()
    assert ready['preview_path'] == d['preview_path']
    assert client.get('/api/watermark/drafts?search=摄影署名').json()['total'] == 1
    assert client.get('/api/watermark/drafts?search=我的作品&status=ready').json()['total'] == 1
    copy = client.post('/api/watermark/drafts/'+d['id']+'/duplicate').json()
    assert copy['id'] != d['id'] and copy['name'].endswith('副本')
    opts = copy['settings_json'] | {'template':'frame','theme':'black'}
    changed = client.put('/api/watermark/drafts/'+copy['id'],json={'revision':copy['revision'],'settings_json':opts}).json()
    assert changed['preview_path'] != copy['preview_path']
    assert not Path(copy['preview_path']).exists()
    assert client.get('/api/watermark/drafts/'+d['id']).json()['settings_json']['template']=='ambient'
    assert client.put('/api/watermark/drafts/'+copy['id'],json={'revision':copy['revision'],'name':'stale'}).status_code == 409
    assert client.delete('/api/watermark/drafts/'+d['id']).status_code==200
    assert not preview.exists() and path.is_file()
    assert Path(changed['preview_path']).exists()

def test_each_draft_uses_own_design_and_export_tracking(client,image_factory):
    path = image_factory()
    import_paths(client,[path]);photo=client.get('/api/photos').json()['photos'][0]
    a = create(client,photo['id'],template='frame',style='classic_frame',theme='white',fields=[],long_edge=500)
    b = create(client,photo['id'],template='frame',style='classic_frame',theme='black',fields=[],long_edge=500)
    job = client.post('/api/watermark/drafts/batch-export',json={'draft_ids':[a['id'],b['id']],'format':'png'}).json()
    finished=wait_job(client,job)
    assert finished['success']==2 and not finished['failed'],finished
    colors=[]
    for result in finished['results']:
        with Image.open(result['path']) as image: colors.append(image.convert('RGB').getpixel((0,0)))
        d=client.get('/api/watermark/drafts/'+result['draft_id']).json()
        assert d['status']=='exported' and d['last_exported_at'] and not d['modified_since_export']
    assert sum(colors[0])>sum(colors[1])+300
    counts=client.get('/api/watermark/drafts').json()['counts'];assert counts['exported']==2
    response=client.put('/api/watermark/drafts/'+a['id'],json={'revision':a['revision'],'settings_json':a['settings_json']|{'signature':'新署名','fields':['signature']}})
    assert response.status_code==200,response.text
    changed=response.json();assert changed['modified_since_export'] and changed['status']=='draft'
    assert client.post('/api/watermark/drafts/'+a['id']+'/export',json={}).status_code==200
    assert not client.get('/api/watermark/drafts/'+a['id']).json()['modified_since_export']
    client.delete('/api/watermark/drafts/'+a['id'])
    assert all(Path(r['path']).is_file() for r in finished['results']) and path.is_file()

def test_missing_source_retained_relocated_and_library_removal(client,image_factory,tmp_path):
    path=image_factory();import_paths(client,[path]);photo=client.get('/api/photos').json()['photos'][0]
    d=create(client,photo['id']);moved=tmp_path/'moved.jpg';path.rename(moved)
    assert client.get('/api/watermark/drafts/'+d['id']).json()['source_missing']
    assert client.post('/api/watermark/drafts/'+d['id']+'/export',json={}).status_code==400
    assert client.get('/api/watermark/drafts/'+d['id']).json()['status']=='draft'
    wrong=image_factory('wrong.jpg',color=(0,30,240))
    assert client.post('/api/watermark/drafts/'+d['id']+'/relocate',json={'path':str(wrong)}).status_code==400
    r=client.post('/api/watermark/drafts/'+d['id']+'/relocate',json={'path':str(moved)})
    assert r.status_code==200,r.text
    assert not r.json()['source_missing']
    assert client.delete('/api/photos/'+photo['id']).status_code==200
    orphan=client.get('/api/watermark/drafts/'+d['id']).json()
    assert orphan['photo_id'] is None and orphan['source_missing'] and Path(orphan['preview_path']).exists()
    r=client.post('/api/watermark/drafts/'+d['id']+'/relocate',json={'path':str(moved)})
    assert r.status_code==200,r.text
    assert not r.json()['source_missing'] and moved.is_file()

def test_filters_sort_pagination_and_unicode_metadata(client,image_factory):
    path=image_factory();import_paths(client,[path]);photo=client.get('/api/photos').json()['photos'][0]
    from backend.app.models import Session, Photo
    with Session() as session:
        record=session.get(Photo,photo['id']);record.camera_model='中文相机';session.commit()
    drafts=[create(client,photo['id'],template='ambient' if i==2 else 'frame') for i in range(3)]
    client.patch('/api/watermark/drafts/'+drafts[0]['id']+'/status',json={'status':'ready'})
    r=client.get('/api/watermark/drafts?status=ready&search=中文相机').json()
    assert r['total']==1 and r['counts']['all']==3 and r['counts']['draft']==2
    assert client.get('/api/watermark/drafts?watermark_type=ambient').json()['total']==1
    a=client.get('/api/watermark/drafts?page_size=1&page=1&sort=updated_asc').json()
    b=client.get('/api/watermark/drafts?page_size=1&page=2&sort=updated_asc').json()
    assert len(a['drafts'])==1 and a['drafts'][0]['id']!=b['drafts'][0]['id']
    assert client.get('/api/watermark/drafts?photo_id='+photo['id']).json()['total']==3

def test_custom_draft_output_and_output_only_edits_skip_preview(client,image_factory,tmp_path):
    path=image_factory();import_paths(client,[path]);photo=client.get('/api/photos').json()['photos'][0]
    d=create(client,photo['id'])
    output=tmp_path/'chosen-exports'
    r=client.post('/api/watermark/drafts/'+d['id']+'/export',json={'output_directory':str(output),'long_edge':400})
    assert r.status_code==200,r.text
    assert Path(r.json()['path']).parent==output
    assert client.get(r.json()['url']).status_code==200
    private=output/'private.txt';private.write_text('private')
    assert client.get('/api/exports/private.txt').status_code==404
    updated=client.put('/api/watermark/drafts/'+d['id'],json={'revision':d['revision'],'settings_json':d['settings_json']|{'quality':80}}).json()
    assert updated['preview_path']==d['preview_path'] and updated['modified_since_export']
    from backend.app.services import import_service, jobs
    scan=jobs.submit('import',import_service.import_paths,[str(tmp_path)],True,True)
    result=wait_job(client,scan)
    assert result['success']==0 and result['skipped']==1,result
