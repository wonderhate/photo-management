from backend.app.migrations import SCHEMA_VERSION
import copy,hashlib,sqlite3
from pathlib import Path
import pytest
from fastapi import HTTPException
from backend.app.models import Session,LutAsset
from backend.app.services import lut_folder_service as folders
from backend.app.lut_folders import header,validate_folders
from backend.app.config import DATA
from backend.app import migrations
from test_lut_library import SOURCE

def fixture(tmp_path):
    root=tmp_path/'styles';(root/'Cinema').mkdir(parents=True)
    source=root/'Cinema'/'Neutral.cube';source.write_bytes(b'# Input: S-Log3\n'+SOURCE)
    (root/'broken.cube').write_text('LUT_1D_SIZE 2\n')
    return root,source

def test_folder_scan_cache_preview_pin_relink_and_offline_preserve_originals(client,tmp_path,monkeypatch):
    root,source=fixture(tmp_path);original=source.read_bytes();f=folders.register(str(root));f=folders.scan(f['id'])
    assert len(f['entries'])==2
    entry=next(e for e in f['entries'] if e['asset']);asset=entry['asset'];assert entry['comments']==['Input: S-Log3']
    assert any(e['error']=='header' for e in f['entries'])
    read=folders._read
    def guarded(path,*args):
        assert path!=source,'unchanged valid files must reuse the scan cache'
        return read(path,*args)
    monkeypatch.setattr(folders,'_read',guarded);assert folders.scan(f['id'])==f;monkeypatch.setattr(folders,'_read',read)
    assert client.get('/api/editor/luts/'+asset['id']+'/preview-source').content==original
    with Session() as s:assert s.query(LutAsset).count()==0
    assert any(a['id']==asset['id'] for a in client.get('/api/editor/luts').json())
    assert client.post('/api/editor/luts/'+asset['id']+'/pin').status_code==200
    source.write_bytes(b'# new source\n'+original);new=folders.scan(f['id']);assert new['revision']>f['revision']
    assert client.get('/api/editor/luts/'+asset['id']+'/source').content==original
    relocated=tmp_path/'relocated';root.rename(relocated)
    missing=folders.scan(f['id']);assert missing['state']=='missing' and missing['entries']==new['entries']
    linked=folders.register(str(relocated),f['id']);assert linked['binding']!=f['binding'];folders.scan(f['id']);folders.remove(f['id'])
    assert (relocated/'Cinema'/'Neutral.cube').read_bytes()==b'# new source\n'+original
    assert client.get('/api/editor/luts/'+asset['id']+'/source').content==original
    assert folders.list_folders()==[]

def test_folder_changed_or_removed_during_read_cannot_publish_snapshot(client,tmp_path,monkeypatch):
    root,source=fixture(tmp_path);f=folders.scan(folders.register(str(root))['id']);asset=next(e['asset'] for e in f['entries'] if e['asset']);read=folders._read
    def remove_during_read(*args):
        data=read(*args);folders.remove(f['id']);return data
    monkeypatch.setattr(folders,'_read',remove_during_read)
    with pytest.raises(HTTPException) as error:folders.ensure_asset(asset['id'])
    assert error.value.status_code==409
    with Session() as s:assert s.query(LutAsset).count()==0
    assert source.exists()

def test_folder_scan_race_bounds_and_private_library_rejection(client,tmp_path,monkeypatch):
    root,source=fixture(tmp_path);f=folders.register(str(root));read=folders._read
    def remove_during_read(*args):
        data=read(*args);folders.remove(f['id']);return data
    monkeypatch.setattr(folders,'_read',remove_during_read)
    with pytest.raises(HTTPException):folders.scan(f['id'])
    assert folders.list_folders()==[];monkeypatch.setattr(folders,'_read',read)
    with pytest.raises(HTTPException):folders.register(str(DATA))
    f=folders.register(str(root));monkeypatch.setattr(folders,'MAX_ENTRIES',1);result=folders.scan(f['id']);assert result['truncated'] and len(result['entries'])==1

def test_folder_schema20_backup_failure_and_copy_metadata(client,tmp_path,monkeypatch):
    root,source=fixture(tmp_path);record=folders.scan(folders.register(str(root))['id'])
    from backend.migrate_storage import migrate
    target=tmp_path/'copied';migrate(DATA,target)
    with sqlite3.connect(target/'library.db') as db:
        import json
        assert json.loads(db.execute('SELECT record FROM lut_folders').fetchone()[0])==record
    old=migrations.backup_database(DATA/'library.db',tmp_path/'old.db')
    with sqlite3.connect(old) as db:db.execute('DROP TABLE lut_folders');db.execute('PRAGMA user_version=19')
    before=old.read_bytes();backup=migrations.backup_database
    def fail(*args,**kwargs):raise OSError('synthetic backup failure')
    monkeypatch.setattr(migrations,'backup_database',fail)
    with pytest.raises(OSError):migrations.migrate_database(old)
    assert old.read_bytes()==before
    monkeypatch.setattr(migrations,'backup_database',backup);migrations.migrate_database(old)
    with sqlite3.connect(old) as db:assert db.execute('PRAGMA user_version').fetchone()[0]==SCHEMA_VERSION
    bad=backup(DATA/'library.db',tmp_path/'mislabel.db')
    with sqlite3.connect(bad) as db:db.execute('PRAGMA user_version=19')
    before=bad.read_bytes()
    with pytest.raises(ValueError):migrations.migrate_database(bad)
    assert bad.read_bytes()==before

def test_folder_record_header_and_paths_reject_corruption(client,tmp_path):
    root,_=fixture(tmp_path);f=folders.scan(folders.register(str(root))['id']);validate_folders([f])
    for path in ['../x.cube','/x.cube','C:\\x.cube','a//x.cube','a/./x.cube']:
        bad=copy.deepcopy(f);bad['entries'][0]['path']=path
        with pytest.raises(ValueError):validate_folders([bad])
    for text in ['LUT_1D_SIZE 2','LUT_3D_SIZE 1','LUT_3D_SIZE 2\nLUT_3D_SIZE 2','TITLE "bad\nLUT_3D_SIZE 2']:
        with pytest.raises(ValueError):header(text)
    assert header('# Input: '+('\U0001f600'*400)+'\nLUT_3D_SIZE 2')['comments'][0].encode('utf-16-le').__len__()<=1024
