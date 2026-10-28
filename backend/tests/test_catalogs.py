import hashlib
from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import time
from threading import Event
from urllib.request import Request, urlopen, build_opener, ProxyHandler
from urllib.error import HTTPError
import pytest
from backend.app import catalog, config, storage, runtime_control
from backend.app.catalog_routes import initialize_empty
from backend.app.services import jobs
from test_library import import_paths


@pytest.fixture
def catalogs(monkeypatch):
    root=Path(__file__).resolve().parents[2]/'.test-artifacts'
    with tempfile.TemporaryDirectory(prefix='catalogs-',dir=root) as folder:
        directory=Path(folder)
        monkeypatch.setattr(config,'LOCAL_CONFIG_FILE',directory/'library-config.json')
        monkeypatch.setattr(config,'LEGACY_CONFIG_FILE',None)
        monkeypatch.setattr(config,'LOCKED_STORAGE',[])
        yield directory


def drained():
    deadline=time.monotonic()+5
    while jobs.resources()['pending'] and time.monotonic()<deadline:time.sleep(.01)
    assert jobs.resources()['pending']==0


def new_library(root,name):
    path=root/name;path.mkdir();initialize_empty(path);return path


def identity(client):return client.get('/api/workspace').json()['library_id']


def test_existing_catalog_selection_never_copies_and_restores_per_library_paths(client,catalogs,image_factory):
    source=image_factory();digest=hashlib.sha256(source.read_bytes()).hexdigest();import_paths(client,[source]);drained()
    target=new_library(catalogs,'second');before=(target/'library.db').read_bytes()
    payload={'library_id':identity(client),'path':str(target)}
    preview=client.post('/api/workspace/catalogs/inspect',json=payload);assert preview.status_code==200
    target_id=preview.json()['library_id'];assert target_id!=payload['library_id'] and preview.json()['photo_count']==0
    selected=client.post('/api/workspace/catalogs/select',json=payload);assert selected.status_code==200,selected.text
    assert selected.json()['pending']['library_id']==target_id
    assert client.get('/api/photos').json()['total']==1 and identity(client)==payload['library_id']
    assert (target/'library.db').read_bytes()==before and list(target.iterdir())==[target/'library.db']
    previous=storage.read_config(config.LOCAL_CONFIG_FILE)
    applied,error=catalog.apply_pending(config.LOCAL_CONFIG_FILE,previous)
    assert not error and applied['data_dir']==str(target) and applied['scan_paths']==[]
    paths=config.storage_paths()['current']|{'data_dir':str(target),'exports_dir':str(target/'exports'),'scan_paths':[]}
    remembered=catalog.select(config.LOCAL_CONFIG_FILE,paths,str(config.DATA))
    restored,error=catalog.apply_pending(config.LOCAL_CONFIG_FILE,remembered)
    assert not error and restored['exports_dir']==previous['exports_dir'] and restored['scan_paths']==previous['scan_paths']
    assert len(catalog.history(restored))==2 and hashlib.sha256(source.read_bytes()).hexdigest()==digest


def test_new_catalog_is_independent_and_occupied_or_locked_targets_are_kept(client,catalogs,monkeypatch):
    old=identity(client);occupied=catalogs/'occupied';occupied.mkdir();(occupied/'keep.jpg').write_bytes(b'synthetic-original')
    base={'library_id':old,'create':True}
    assert client.post('/api/workspace/catalogs/select',json=base|{'path':str(occupied)}).status_code==400
    assert (occupied/'keep.jpg').read_bytes()==b'synthetic-original'
    path=catalogs/'new'
    with monkeypatch.context() as patch:
        patch.setattr(config,'LOCKED_STORAGE',['data_dir'])
        assert client.post('/api/workspace/catalogs/select',json=base|{'path':str(path)}).status_code==400
        assert not path.exists()
    created=client.post('/api/workspace/catalogs/select',json=base|{'path':str(path)})
    assert created.status_code==200,created.text
    pending=created.json()['pending'];assert pending['library_id']!=old and pending['photo_count']==0
    assert identity(client)==old and catalog.inspect(str(path))['library_id']==pending['library_id']
    assert client.put('/api/library/paths',json=config.storage_paths()['current']).status_code==400
    assert client.post('/api/workspace/catalogs/cancel',json={'library_id':old}).json()['pending'] is None
    assert (path/'library.db').exists()  # Cancelling a switch never deletes a newly created library.
    assert client.post('/api/workspace/catalogs/select',json=base|{'library_id':'old-window','path':str(catalogs/'untouched')}).status_code==409
    assert not (catalogs/'untouched').exists()


def test_replaced_or_newer_catalog_fails_before_startup_switch_and_original_config_is_kept(client,catalogs):
    target=new_library(catalogs,'selected');old=identity(client)
    assert client.post('/api/workspace/catalogs/select',json={'library_id':old,'path':str(target)}).status_code==200
    before=storage.read_config(config.LOCAL_CONFIG_FILE)
    with closing(sqlite3.connect(target/'library.db')) as connection:
        connection.execute("UPDATE library_profile SET library_id='replacement' WHERE singleton=1");connection.commit()
    result,error=catalog.apply_pending(config.LOCAL_CONFIG_FILE,before)
    assert error and '替换' in error and result==before
    assert storage.read_config(config.LOCAL_CONFIG_FILE)==before and identity(client)==old
    with closing(sqlite3.connect(target/'library.db')) as connection:
        connection.execute('PRAGMA user_version=999');connection.commit()
    assert client.post('/api/workspace/catalogs/inspect',json={'library_id':old,'path':str(target)}).status_code==400
    broken=catalogs/'broken';broken.mkdir();(broken/'library.db').write_bytes(b'damaged-synthetic-db')
    assert client.post('/api/workspace/catalogs/inspect',json={'library_id':old,'path':str(broken)}).status_code==400
    assert (broken/'library.db').read_bytes()==b'damaged-synthetic-db'


def test_switch_waits_for_jobs_and_saves_then_closes_admission_and_rejects_old_sessions(client,catalogs):
    drained();target=new_library(catalogs,'other');old=identity(client);started=Event();release=Event();restarted=Event()
    runtime_control.install(restarted.set)
    def blocked(_id):started.set();assert release.wait(5)
    try:
        job=jobs.submit('import',blocked);assert started.wait(2)
        assert client.post('/api/workspace/catalogs/select',json={'library_id':old,'path':str(target)}).status_code==409
        jobs.cancel(job['id']);release.set();drained()
        selected=client.post('/api/workspace/catalogs/select',json={'library_id':old,'path':str(target)}).json()['pending']
        payload={'library_id':old,'selection_id':selected['selection_id']}
        runtime_control.enter_mutation()
        try:assert client.post('/api/workspace/catalogs/activate',json=payload).status_code==409
        finally:runtime_control.leave_mutation()
        assert not runtime_control.snapshot()['switching']
        assert client.post('/api/workspace/catalogs/activate',json=payload|{'selection_id':'stale'}).status_code==400
        assert not runtime_control.snapshot()['switching']
        assert client.post('/api/workspace/catalogs/activate',json=payload).status_code==200
        assert client.post('/api/albums',json={'name':'must not save','photo_ids':[]}).status_code==409
        with pytest.raises(ValueError,match='切换'):jobs.submit('import',lambda _id:None)
        assert restarted.wait(2)
        assert client.get('/api/health',headers={'X-PhotoCollection-Session':'previous-process'}).status_code==409
        assert client.get('/api/photos?pc_session=previous-process').status_code==409
    finally:
        release.set();drained();runtime_control.install(None);runtime_control.release_switch();jobs.resume_after_switch_failure()


def test_save_failure_preserves_selection_and_does_not_create_over_existing_files(client,catalogs,monkeypatch):
    target=new_library(catalogs,'read-only-selection');before=(target/'library.db').read_bytes()
    def denied(*args,**kwargs):raise PermissionError('synthetic read-only config')
    monkeypatch.setattr(storage,'write_config',denied)
    response=client.post('/api/workspace/catalogs/select',json={'library_id':identity(client),'path':str(target)})
    assert response.status_code==400 and '无法保存图库选择' in response.text
    assert not config.LOCAL_CONFIG_FILE.exists() and (target/'library.db').read_bytes()==before


def test_managed_process_reopens_two_catalogs_with_fresh_sessions_and_keeps_originals(catalogs,image_factory):
    first=new_library(catalogs,'first-live');second=new_library(catalogs,'second-live')
    first_id=catalog.inspect(str(first))['library_id'];second_id=catalog.inspect(str(second))['library_id']
    source=image_factory('live-original.jpg');digest=hashlib.sha256(source.read_bytes()).hexdigest()
    configuration=catalogs/'managed-config.json';status_file=catalogs/'managed-status.json'
    storage.write_config(configuration,{'data_dir':str(first),'models_dir':str(catalogs/'models'),'exports_dir':str(first/'exports'),'scan_paths':[]})
    env=os.environ.copy()
    for key in ('PHOTO_DATA_DIR','PHOTO_MODELS_DIR','PHOTO_EXPORT_DIR','DASHSCOPE_API_KEY'):env.pop(key,None)
    env.update(PHOTO_LIBRARY_CONFIG=str(configuration),PHOTO_AUTOLOAD_AI='0',LOCALAPPDATA=str(catalogs/'desktop-state'),XDG_STATE_HOME=str(catalogs/'desktop-state'))
    process=subprocess.Popen([sys.executable,'-m','desktop.launcher','--serve','--port','0','--duration','45','--status-file',str(status_file)],env=env,cwd=Path(__file__).resolve().parents[2],creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    opener=build_opener(ProxyHandler({}));known_pids={process.pid};last_status=None
    def status_after(previous=None):
        deadline=time.monotonic()+20
        while time.monotonic()<deadline:
            try:
                value=json.loads(status_file.read_text('utf-8'))
                if value['run_id']!=previous:known_pids.add(value['pid']);return value
            except (FileNotFoundError,json.JSONDecodeError):pass
            time.sleep(.05)
        logs=list((catalogs/'desktop-state').rglob('desktop.log'));detail=logs[0].read_text('utf-8')[-4000:] if logs else 'No launcher log in the isolated profile'
        raise AssertionError('Managed launcher did not publish a new ready status: '+detail)
    def request(path,method='GET',value=None,headers=None):
        data=None if value is None else json.dumps(value).encode()
        req=Request(last_status['url']+'/api'+path,data=data,method=method,headers={'Content-Type':'application/json',**(headers or {})})
        try:
            with opener.open(req,timeout=10) as response:return response.status,json.load(response)
        except HTTPError as error:return error.code,json.load(error)
    try:
        last_status=status_after();assert last_status['data_dir']==str(first)
        assert request('/workspace')[1]['library_id']==first_id
        started=request('/photos/import','POST',{'paths':[str(source)]})[1]
        deadline=time.monotonic()+10
        while request('/jobs/'+started['id'])[1]['status'] in ('queued','running') and time.monotonic()<deadline:time.sleep(.02)
        assert request('/jobs/'+started['id'])[1]['success']==1
        assert request('/workspace/preferences','PATCH',{'library_id':first_id,'values':{'layout':'waterfall'}})[0]==200
        session_a=request('/workspace')[1]['session_id'];old_headers={'X-PhotoCollection-Library':first_id,'X-PhotoCollection-Session':session_a}
        key_saved=request('/art/settings')[1].get('can_save_key',False)
        if key_saved:assert request('/art/settings','PUT',{'api_key':'synthetic-catalog-session-key'})[0]==200
        for target,expected in ((second,second_id),(first,first_id)):
            current=request('/workspace')[1]['library_id']
            code,value=request('/workspace/catalogs/select','POST',{'library_id':current,'path':str(target)});assert code==200,value
            pending=value['pending'];assert request('/workspace/catalogs/activate','POST',{'library_id':current,'selection_id':pending['selection_id']})[0]==200
            last_status=status_after(last_status['run_id']);assert last_status['data_dir']==str(target)
            state=request('/workspace')[1];assert state['library_id']==expected and state['session_id']!=session_a
            assert request('/settings','PUT',{'thumbnail_quality':31},old_headers)[0]==409
            assert request('/photos?pc_session='+session_a)[0]==409
            assert request('/settings')[1]['thumbnail_quality']!=31
            if expected==second_id:
                assert request('/photos')[1]['total']==0 and request('/jobs')[1]==[]
                assert state['preferences']=={}
                assert not request('/art/settings')[1]['configured']
            else:
                assert request('/photos')[1]['total']==1 and state['preferences']['layout']=='waterfall'
                assert request('/jobs/'+started['id'])[1]['success']==1
                if key_saved:assert request('/art/settings')[1]['configured']
        assert hashlib.sha256(source.read_bytes()).hexdigest()==digest
        assert len(request('/workspace/catalogs')[1]['recent'])==2
    finally:
        # Every PID comes from the launcher started above and its own isolated status file.
        if status_file.exists():
            try:known_pids.add(json.loads(status_file.read_text('utf-8'))['pid'])
            except (KeyError,json.JSONDecodeError):pass
        for pid in known_pids:
            if os.name=='nt':
                command=subprocess.run(['powershell','-NoProfile','-Command',f"(Get-CimInstance Win32_Process -Filter 'ProcessId = {pid}').CommandLine"],capture_output=True,text=True).stdout
                if 'desktop.launcher' in command and str(status_file) in command:
                    subprocess.run(['taskkill','/PID',str(pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            elif pid==process.pid:process.terminate()
        process.wait(timeout=10)
