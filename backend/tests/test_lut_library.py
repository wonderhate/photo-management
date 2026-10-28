from backend.app.migrations import SCHEMA_VERSION
import hashlib
import json
import sqlite3
from pathlib import Path
import pytest
from backend.app.cube_lut import parse_cube,validate_lut_selection,validate_lut_asset
from backend.app.config import DATA
from backend.app.models import Session,LutAsset,EditDocument
from backend.app import migrations
from backend.library_maintenance import merge_libraries
from backend.migrate_storage import migrate
from test_editor import create_edit,NEUTRAL

FIXTURE=json.loads((Path(__file__).parents[2]/'frontend/tests/fixtures/cube-lut-contract.json').read_text(encoding='utf-8'))
SOURCE=FIXTURE['valid'][0]['text'].encode('utf-8')

def imported(client,source=SOURCE,name='Identity.cube'):
    response=client.post('/api/editor/luts',files={'file':(name,source,'application/octet-stream')});assert response.status_code==201,response.text;return response.json()

def recipe(asset):return NEUTRAL|dict(version=5,composition=dict(source_width=640,source_height=480,angle=0),layer_stack=dict(version=1,layers=[]),lut=dict(version=1,asset_hash=asset['id'],strength=.5,input='srgb'))

def test_cube_shared_contract():
    for case in FIXTURE['valid']:
        result=parse_cube(case['text'].encode('utf-8'));assert result['size']==case['size'] and result['title']==case['title'],case['name']
    for case in FIXTURE['invalid']:
        with pytest.raises(ValueError):parse_cube(case['text'].encode('utf-8'))
    with pytest.raises(ValueError):parse_cube(b'\xff\xfe')
    with pytest.raises(ValueError):validate_lut_selection(dict(version=1,asset_hash='a'*64,strength=True,input='srgb'))

def test_lut_import_duplicate_preferences_and_hidden_sources_are_immutable(client,image_factory):
    asset=imported(client);validate_lut_asset(asset);assert asset['id']==hashlib.sha256(SOURCE).hexdigest()
    assert client.patch('/api/editor/luts/'+asset['id'],json={'favorite':True}).status_code==200
    assert client.post('/api/editor/luts/'+asset['id']+'/used').status_code==200
    assert client.patch('/api/editor/luts/'+asset['id'],json={'hidden':True}).status_code==200
    path=image_factory('lut-original.jpg');before=path.read_bytes();saved=create_edit(client,path,recipe=recipe(asset));assert saved['recipe']==recipe(asset)
    assert client.get('/api/editor/luts/'+asset['id']+'/source').content==SOURCE
    again=imported(client,name='Renamed.cube');assert again['id']==asset['id'] and again['favorite'] and again['used_at'] and not again['hidden'];assert len(client.get('/api/editor/luts').json())==1
    assert client.patch('/api/editor/luts/'+asset['id'],json={'favorite':'yes'}).status_code==422
    assert client.patch('/api/editor/luts/'+asset['id'],json={'source':'replace'}).status_code==422
    assert path.read_bytes()==before

def test_lut_missing_or_damaged_source_refuses_edit_without_changing_original(client,image_factory):
    asset=imported(client);path=image_factory('lut-damaged.jpg');before=path.read_bytes();saved=create_edit(client,path,recipe=recipe(asset))
    with Session() as session:row=session.get(LutAsset,asset['id']);row.source=b'changed';session.commit()
    assert client.get('/api/editor/luts/'+asset['id']+'/source').status_code==409
    response=client.put('/api/editor/edits/'+saved['id'],json=dict(revision=1,source_hash=saved['source_hash'],recipe=recipe(asset)));assert response.status_code==409
    with Session() as session:assert session.get(EditDocument,saved['id']).revision==1
    assert path.read_bytes()==before

def test_lut_import_invalid_or_commit_failure_leaves_no_partial_asset(client,monkeypatch):
    from sqlalchemy.orm import Session as OrmSession
    assert client.post('/api/editor/luts',files={'file':('bad.cube',b'LUT_3D_SIZE 2\n0 0 0')}).status_code==422
    def fail(_):raise OSError('Synthetic LUT commit failure')
    monkeypatch.setattr(OrmSession,'commit',fail)
    with pytest.raises(OSError):imported(client)
    with Session() as session:assert session.query(LutAsset).count()==0

def test_lut_schema19_backup_failure_and_mislabeled_data(client,tmp_path,monkeypatch):
    target=migrations.backup_database(DATA/'library.db',tmp_path/'old.db')
    with sqlite3.connect(target) as db:db.execute('DROP TABLE lut_assets');db.execute('PRAGMA user_version=18')
    before=target.read_bytes();backup=migrations.backup_database
    def fail(*args,**kwargs):raise OSError('Synthetic backup failure')
    monkeypatch.setattr(migrations,'backup_database',fail)
    with pytest.raises(OSError):migrations.migrate_database(target)
    assert target.read_bytes()==before
    monkeypatch.setattr(migrations,'backup_database',backup);migrations.migrate_database(target)
    with sqlite3.connect(target) as db:assert db.execute('PRAGMA user_version').fetchone()[0]==SCHEMA_VERSION
    imported(client);bad=migrations.backup_database(DATA/'library.db',tmp_path/'bad.db')
    with sqlite3.connect(bad) as db:db.execute('PRAGMA user_version=18')
    before=bad.read_bytes()
    with pytest.raises(ValueError):migrations.migrate_database(bad)
    assert bad.read_bytes()==before

def test_lut_copy_merge_and_reference_validation_include_exact_asset_bytes(client,image_factory,tmp_path):
    asset=imported(client);path=image_factory('lut-copy.jpg');before=path.read_bytes();saved=create_edit(client,path,recipe=recipe(asset));moved=tmp_path/'moved';migrate(DATA,moved)
    with sqlite3.connect(moved/'library.db') as db:assert db.execute('SELECT source FROM lut_assets WHERE id=?',(asset['id'],)).fetchone()[0]==SOURCE
    target=migrations.backup_database(DATA/'library.db',tmp_path/'target.db');incoming=migrations.backup_database(DATA/'library.db',tmp_path/'incoming.db');stage=tmp_path/'stage.db'
    merge_libraries(target,incoming,stage,tmp_path/'old',tmp_path/'new')
    with sqlite3.connect(stage) as db:assert db.execute('SELECT count(*) FROM lut_assets').fetchone()[0]==1;assert db.execute('SELECT count(*) FROM edit_documents').fetchone()[0]==2
    with sqlite3.connect(incoming) as db:db.execute('DELETE FROM lut_assets')
    target_before=target.read_bytes()
    with pytest.raises(ValueError):merge_libraries(target,incoming,tmp_path/'bad-stage.db',tmp_path/'old',tmp_path/'new')
    assert target.read_bytes()==target_before and path.read_bytes()==before
