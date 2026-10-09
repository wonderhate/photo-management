import shutil
from pathlib import Path
from backend.tests.test_library import import_paths, wait_job
from backend.app.services import import_service, scan_service, watermark_service, export_registry

def test_auto_scan_imports_existing_images_and_excludes_derivatives(client, image_factory, tmp_path, monkeypatch):
    root=tmp_path/'photo-root'
    root.mkdir()
    first=image_factory('first.jpg',color=(45,125,10))
    second=image_factory('second.jpg',color=(150,25,200))
    derived=image_factory('derived.jpg',color=(10,30,210))
    shutil.copy2(first,root/'first.jpg')
    (root/'subfolder').mkdir()
    shutil.copy2(second,root/'subfolder'/'second.jpg')
    for name in ('thumbnails','previews','watermark_previews','exports'):
        (root/name).mkdir()
        shutil.copy2(derived,root/name/'must-not-import.jpg')
    monkeypatch.setattr(import_service,'DATA',root)
    monkeypatch.setattr(scan_service,'SCAN_PATHS',[str(root)])
    monkeypatch.setattr(scan_service,'_job_id',None)
    monkeypatch.setattr(scan_service,'_started',0)
    scan=client.post('/api/library/scan').json()
    finished=wait_job(client,scan['job'])
    assert finished['success']==2 and finished['failed']==0,finished
    assert client.get('/api/photos').json()['total']==2
    assert client.get('/api/library/scan').json()['job']['id']==scan['job']['id']
    assert client.post('/api/library/scan').json()['job']['id']==scan['job']['id']
    repeated=client.post('/api/library/scan?force=true').json()
    assert repeated['job']['id']!=scan['job']['id']
    assert wait_job(client,repeated['job'])['skipped']==2

def test_custom_exports_are_downloadable_without_exposing_downloads(client,image_factory,tmp_path,monkeypatch):
    original=image_factory('export-source.jpg')
    import_paths(client,[original])
    photo=client.get('/api/photos').json()['photos'][0]
    downloads=tmp_path/'Downloads';downloads.mkdir()
    unrelated=downloads/'private.jpg';unrelated.write_bytes(b'not an application export')
    monkeypatch.setattr(watermark_service,'EXPORTS',downloads)
    monkeypatch.setattr(export_registry,'EXPORTS',downloads)
    response=client.post('/api/watermark/export',json={'photo_id':photo['id'],'options':{'long_edge':400,'filename_template':'中文 # 测试'}})
    assert response.status_code==200,response.text
    result=response.json()
    assert Path(result['path']).parent==downloads
    assert Path(result['path']).is_file()
    assert '%23' in result['url']
    assert client.get(result['url']).status_code==200
    assert client.get('/api/exports/private.jpg').status_code==404
    assert unrelated.read_bytes()==b'not an application export'
    backup=client.post('/api/backup').json()
    assert client.get(backup['url']).status_code==200
