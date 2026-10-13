import shutil
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from backend.tests.test_library import import_paths, wait_job
from backend.app.services import import_service, scan_service, watermark_service, export_registry
from backend.app import config, storage


def isolated_storage(monkeypatch,tmp_path):
    path=tmp_path/'config'/'library-config.json'
    monkeypatch.setattr(config,'LOCAL_CONFIG_FILE',path)
    monkeypatch.setattr(config,'LEGACY_CONFIG_FILE',None)
    monkeypatch.setattr(config,'LOCKED_STORAGE',[])
    return path


def test_edit_storage_paths_validates_saves_pending_and_cancels(client,tmp_path,monkeypatch):
    path=isolated_storage(monkeypatch,tmp_path)
    current=client.get('/api/library/paths').json()['current']
    scans=tmp_path/'原图';scans.mkdir()
    target=tmp_path/'新照片库'
    requested=current|{'data_dir':str(target),'exports_dir':str(tmp_path/'新导出'),'scan_paths':[str(scans),str(scans)]}
    occupied=tmp_path/'已有文件';occupied.mkdir();(occupied/'private.txt').write_text('保留')
    for invalid in [requested|{'data_dir':'relative'},requested|{'data_dir':str(occupied)},requested|{'data_dir':str(config.DATA/'nested')},requested|{'exports_dir':str(occupied/'private.txt')},requested|{'scan_paths':[str(tmp_path/'missing')]}]:
        assert client.put('/api/library/paths',json=invalid).status_code==400
    assert not path.exists() and (occupied/'private.txt').read_text()=='保留'
    with monkeypatch.context() as patch:
        patch.setattr(config,'LOCKED_STORAGE',['data_dir'])
        assert client.put('/api/library/paths',json=requested).status_code==400
    with monkeypatch.context() as patch:
        def denied(*args,**kwargs): raise PermissionError('readonly')
        patch.setattr(storage,'NamedTemporaryFile',denied)
        assert client.put('/api/library/paths',json=requested).status_code==400
    response=client.put('/api/library/paths',json=requested)
    assert response.status_code==200,response.text
    saved=response.json()
    assert saved['current']==current and saved['pending']['scan_paths']==[str(scans)]
    assert not target.exists()
    assert client.get('/api/library/paths').json()['pending']==saved['pending']
    assert client.get('/api/settings').json()['data_dir']==current['data_dir']
    assert client.delete('/api/library/paths').json()['pending'] is None
    assert 'pending_paths' not in json.loads(path.read_text('utf-8'))


def test_storage_restart_copies_library_drafts_and_preserves_sources(client,image_factory,tmp_path,monkeypatch):
    path=isolated_storage(monkeypatch,tmp_path)
    original=image_factory('external.jpg')
    uploaded=image_factory('browser.jpg',day=12,color=(15,80,200))
    digests={item:hashlib.sha256(item.read_bytes()).hexdigest() for item in [original,uploaded]}
    import_paths(client,[original])
    job=client.post('/api/photos/upload',files=[('files',('browser.jpg',uploaded.read_bytes(),'image/jpeg'))]).json()
    assert wait_job(client,job)['success']==1
    photos=client.get('/api/photos').json()['photos']
    photo=next(item for item in photos if item['file_name']=='external.jpg')
    browser=next(item for item in photos if item['file_name']=='browser.jpg')
    client.patch('/api/photos/'+photo['id'],json={'favorite':True})
    draft=client.post('/api/watermark/drafts',json={'photo_id':photo['id'],'settings_json':{'signature':'迁移验证'}}).json()
    album=client.post('/api/albums',json={'name':'保留影集','photo_ids':[item['id'] for item in photos]}).json()
    old_exports=tmp_path/'旧导出';old_exports.mkdir()
    monkeypatch.setattr(config,'EXPORTS',old_exports)
    monkeypatch.setattr(watermark_service,'EXPORTS',old_exports)
    monkeypatch.setattr(export_registry,'EXPORTS',old_exports)
    exported=client.post('/api/watermark/export',json={'photo_id':photo['id'],'options':{'long_edge':200}}).json()
    current=client.get('/api/library/paths').json()['current']
    target=tmp_path/'new-library'
    requested=current|{'data_dir':str(target),'models_dir':str(tmp_path/'new-models'),'exports_dir':str(tmp_path/'new-exports')}
    assert client.put('/api/library/paths',json=requested).status_code==200
    # A fresh process exercises config bootstrap, migration and real API reads.
    env={key:value for key,value in os.environ.items() if key not in ('PHOTO_DATA_DIR','PHOTO_MODELS_DIR','PHOTO_EXPORT_DIR')}
    env.update(PHOTO_LIBRARY_CONFIG=str(path),PHOTO_AUTOLOAD_AI='0')
    check="""
import json,sys
from pathlib import Path
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.config import DATA, STORAGE_ERROR
photo_id,browser_id,draft_id,album_id,url,expected=sys.argv[1:]
assert str(DATA)==expected, STORAGE_ERROR
with TestClient(app) as client:
    assert client.get('/api/photos').json()['total']==2
    assert client.get('/api/photos/'+photo_id).json()['favorite'] is True
    assert client.get('/api/albums/'+album_id).json()['count']==2
    draft=client.get('/api/watermark/drafts/'+draft_id).json()
    assert draft['settings_json']['signature']=='迁移验证'
    assert Path(draft['preview_path']).is_relative_to(DATA)
    assert client.get(draft['preview_url']).status_code==200
    browser=client.get('/api/photos/'+browser_id).json()
    assert Path(browser['file_path']).is_relative_to(DATA/'imports')
    assert client.get(browser['preview_url']).status_code==200
    assert client.get(url).status_code==200
    paths=client.get('/api/library/paths').json()
    assert paths['pending'] is None and paths['error'] is None
    print(json.dumps(paths['current']))
"""
    result=subprocess.run([sys.executable,'-c',check,photo['id'],browser['id'],draft['id'],album['id'],exported['url'],str(target)],cwd=config.PROJECT,env=env,capture_output=True,text=True,encoding='utf-8',timeout=60)
    assert result.returncode==0,result.stdout+result.stderr
    assert json.loads(result.stdout)['data_dir']==str(target)
    assert (config.DATA/'library.db').is_file() and Path(draft['preview_path']).is_file()
    assert Path(browser['file_path']).is_file() and Path(exported['path']).is_file()
    assert all(hashlib.sha256(item.read_bytes()).hexdigest()==digest for item,digest in digests.items())
    assert json.loads(path.read_text('utf-8'))['data_dir']==str(target)


def test_failed_storage_copy_keeps_original_config_and_never_overwrites(client,tmp_path,monkeypatch):
    path=isolated_storage(monkeypatch,tmp_path)
    current=client.get('/api/library/paths').json()['current']
    target=tmp_path/'new-library'
    assert client.put('/api/library/paths',json=current|{'data_dir':str(target)}).status_code==200
    before=path.read_bytes();saved=json.loads(before)
    target.mkdir();protected=target/'private.txt';protected.write_text('保留')
    unchanged,error=storage.apply_pending(path,saved,[])
    assert error and unchanged==saved and protected.read_text()=='保留'
    protected.unlink();target.rmdir()
    with monkeypatch.context() as patch:
        def denied(*args,**kwargs): raise PermissionError('config readonly')
        patch.setattr(storage,'write_config',denied)
        unchanged,error=storage.apply_pending(path,saved,[])
    assert error and unchanged==saved and path.read_bytes()==before
    assert not target.exists() and not list(tmp_path.glob('.photo-library-copy-*'))
    assert (config.DATA/'library.db').is_file()

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
