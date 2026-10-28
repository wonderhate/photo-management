from backend.app.migrations import SCHEMA_VERSION
import json,sqlite3
import pytest
from backend.app.models import Session,LutAsset
from backend.app import migrations
from backend.app.config import DATA
from test_lut_library import SOURCE
from backend.app.services import lut_folder_service as folders

def detailed(client,groups,source=None,name='Look.cube'):
    return client.post('/api/editor/luts?detailed=true',files={'file':(name,source or b'# Input: V-Log\n'+SOURCE)},data={'payload':json.dumps({'groups':groups})})

def test_copy_groups_comments_duplicate_restore_preserve_first_context(client):
    first=detailed(client,['Pack','Cinema','Portrait']);assert first.status_code==201,first.text
    result=first.json();assert result['kind']=='added';a=result['asset'];assert a['version']==2 and a['context']=={'groups':['Pack','Cinema','Portrait'],'comments':['Input: V-Log']}
    client.patch('/api/editor/luts/'+a['id'],json={'favorite':True});client.post('/api/editor/luts/'+a['id']+'/used')
    duplicate=detailed(client,['Another'],name='Alias.cube').json();assert duplicate['kind']=='existing';assert duplicate['asset']['name']=='Look.cube' and duplicate['asset']['context']==a['context'] and duplicate['asset']['favorite'] and duplicate['asset']['used_at']
    client.patch('/api/editor/luts/'+a['id'],json={'hidden':True});restored=detailed(client,[]).json();assert restored['kind']=='restored' and not restored['asset']['hidden']
    with Session() as s:assert s.query(LutAsset).count()==1;assert s.get(LutAsset,a['id']).source==b'# Input: V-Log\n'+SOURCE

def test_copy_context_rejects_paths_and_failed_batch_member_keeps_other_assets(client):
    for groups in [['..'],['/abs'],['C:'],['a\\b'],['a/b'],[''],['x']*10]:assert detailed(client,groups).status_code==422
    assert detailed(client,['Valid']).status_code==201
    assert detailed(client,['Bad'],b'LUT_3D_SIZE 2\n0 0 0').status_code==422
    assert len(client.get('/api/editor/luts').json())==1

def test_linked_context_survives_unlink_and_library_copy(client,tmp_path):
    root=tmp_path/'Pack';(root/'Cinema').mkdir(parents=True);raw=b'# Input: C-Log\n'+SOURCE;source=root/'Cinema'/'Look.cube';source.write_bytes(raw)
    f=folders.scan(folders.register(str(root))['id']);a=f['entries'][0]['asset'];folders.ensure_asset(a['id']);folders.remove(f['id'])
    saved=client.get('/api/editor/luts').json()[0];assert saved['context']=={'groups':['Pack','Cinema'],'comments':['Input: C-Log']}
    from backend.migrate_storage import migrate
    target=tmp_path/'copy';migrate(DATA,target)
    with sqlite3.connect(target/'library.db') as db:meta,data=db.execute('SELECT metadata_json,source FROM lut_assets').fetchone();assert json.loads(meta)==saved and data==raw
    assert source.read_bytes()==raw

def test_context_schema21_semantic_upgrade_and_mislabeled_data(client,tmp_path,monkeypatch):
    a=detailed(client,['Pack']).json()['asset'];bad=migrations.backup_database(DATA/'library.db',tmp_path/'bad.db')
    with sqlite3.connect(bad) as db:db.execute('PRAGMA user_version=20')
    before=bad.read_bytes()
    with pytest.raises(ValueError):migrations.migrate_database(bad)
    assert bad.read_bytes()==before
    legacy=migrations.backup_database(DATA/'library.db',tmp_path/'legacy.db');old={k:v for k,v in a.items() if k!='context'};old['version']=1
    with sqlite3.connect(legacy) as db:db.execute('UPDATE lut_assets SET metadata_json=?',(json.dumps(old),));db.execute('PRAGMA user_version=20')
    before=legacy.read_bytes();backup=migrations.backup_database
    def fail(*a,**kw):raise OSError('synthetic failure')
    monkeypatch.setattr(migrations,'backup_database',fail)
    with pytest.raises(OSError):migrations.migrate_database(legacy)
    assert legacy.read_bytes()==before
    monkeypatch.setattr(migrations,'backup_database',backup);migrations.migrate_database(legacy)
    with sqlite3.connect(legacy) as db:assert db.execute('PRAGMA user_version').fetchone()[0]==SCHEMA_VERSION;assert json.loads(db.execute('SELECT metadata_json FROM lut_assets').fetchone()[0])==old


def test_volume_root_display_name_can_be_snapshotted_without_a_filesystem_group(client,tmp_path):
    from backend.app.models import LutFolder
    root=tmp_path/'volume';root.mkdir();(root/'Look.cube').write_bytes(SOURCE);f=folders.scan(folders.register(str(root))['id'])
    # A real Windows drive-root registration uses its drive string as the label.
    with Session() as s:
        row=s.get(LutFolder,f['id']);row.record={**row.record,'name':'E:\\'};s.commit()
    a=f['entries'][0]['asset'];folders.ensure_asset(a['id'])
    with Session() as s:assert s.get(LutAsset,a['id']).metadata_json['context']['groups']==['E']
    assert (root/'Look.cube').read_bytes()==SOURCE
