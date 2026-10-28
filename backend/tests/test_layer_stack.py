from backend.app.migrations import SCHEMA_VERSION
import json
import sqlite3
from copy import deepcopy
from pathlib import Path
import pytest
from backend.app.editor_schemas import recipe_adapter
from backend.app.models import Session,AssetVariant
from backend.app import migrations
from backend.app.layer_stack import validate_layer_stack
from test_text_layers import recipe as text_recipe
from test_editor import NEUTRAL,create_edit,rendered,digest
from backend.app.config import DATA
from backend.migrate_storage import migrate
from backend.library_maintenance import merge_libraries
from test_split import prepare,post

def recipe(width=640,height=480):
    r=text_recipe(width,height);r.pop('text_layers');r.update(version=4,layer_stack=json.loads((Path(__file__).parents[2]/'frontend/tests/fixtures/layer-stack-contract.json').read_text(encoding='utf-8')));return r

def test_layer_stack_contract_and_legacy_versions_are_strict():
    r=recipe();assert recipe_adapter.validate_python(r).model_dump(exclude_none=True)==r
    for patch in ({'kind':'sticker'},{'coverage':0},{'opacity':True},{'paint':{'kind':'linear','angle':0,'stops':[]}},{'edge':'center'},{'id':'overlay-x'},{'future':True}):
        bad=deepcopy(r['layer_stack']);bad['layers'][0].update(patch)
        with pytest.raises(ValueError):validate_layer_stack(bad)
    for version in (1,2,3,6):
        with pytest.raises(ValueError):recipe_adapter.validate_python(r|{'version':version})
    bad=deepcopy(r['layer_stack']);bad['layers'][0]['paint']['stops'].reverse()
    with pytest.raises(ValueError):validate_layer_stack(bad)

def test_mixed_edits_freeze_outputs_preserve_text_and_reject_silent_downgrade(client,image_factory):
    path=image_factory('mixed-layers.jpg');before=path.read_bytes();r=recipe();saved=create_edit(client,path,recipe=r)
    assert client.get(saved['source_url']).content==before
    for old in (NEUTRAL,text_recipe()):assert client.put('/api/editor/edits/'+saved['id'],json=dict(revision=1,source_hash=saved['source_hash'],recipe=old)).status_code==409
    payload=dict(document_id=saved['id'],document_revision=1,name='mixed.png')
    assert client.post('/api/editor/variants',data={'payload':json.dumps(payload)},files={'file':('mixed.png',rendered())}).status_code==409
    response=client.post('/api/editor/variants',data={'payload':json.dumps(payload|{'expected_recipe':r})},files={'file':('mixed.png',rendered())});assert response.status_code==201,response.text
    changed=deepcopy(r);changed['layer_stack']['layers'].reverse();response2=client.put('/api/editor/edits/'+saved['id'],json=dict(revision=1,source_hash=saved['source_hash'],recipe=changed));assert response2.status_code==200
    with Session() as db:assert db.get(AssetVariant,response.json()['id']).recipe==r
    assert client.post('/api/editor/variants/'+response.json()['id']+'/watermark').status_code==201
    assert path.read_bytes()==before

def test_schema18_backs_up_17_and_refuses_mislabeled_layer_data(client,image_factory,tmp_path,monkeypatch):
    path=image_factory('old-text.jpg');create_edit(client,path,recipe=text_recipe());from backend.app.models import engine
    target=tmp_path/'old.db';migrations.backup_database(Path(engine.url.database),target)
    with sqlite3.connect(target) as db:db.execute('PRAGMA user_version=17')
    before=target.read_bytes();backup=migrations.backup_database
    monkeypatch.setattr(migrations,'backup_database',lambda *_a,**_k:(_ for _ in ()).throw(OSError('Synthetic backup failure')))
    with pytest.raises(OSError):migrations.migrate_database(target)
    assert target.read_bytes()==before
    monkeypatch.setattr(migrations,'backup_database',backup);migrations.migrate_database(target)
    with sqlite3.connect(target) as db:assert db.execute('PRAGMA user_version').fetchone()[0]==SCHEMA_VERSION
    with sqlite3.connect(target) as db:db.execute('UPDATE edit_documents SET recipe=?',(json.dumps(recipe()),));db.execute('PRAGMA user_version=17')
    before=target.read_bytes()
    with pytest.raises(ValueError):migrations.migrate_database(target)
    assert target.read_bytes()==before


def test_overlay_split_freezes_parent_parameters_and_child_is_neutral(client,tmp_path):
    original,before,parent,payload,master,panels=prepare(client,tmp_path)
    r=recipe(payload['spec']['basis']['width'],payload['spec']['basis']['height'])
    response=client.put('/api/editor/edits/'+parent['id'],json=dict(revision=1,source_hash=before,recipe=r));assert response.status_code==200,response.text
    payload['document_revision']=2
    assert post(client,payload,master,panels).status_code==409
    payload['expected_recipe']=r;response=post(client,payload,master,panels);assert response.status_code==201,response.text
    group=response.json();assert group['parent_recipe']==r and group['recipe']['version']==2 and 'layer_stack' not in group['recipe']
    from test_split_edit import child
    result=child(client,group).json();assert result['recipe']==NEUTRAL and client.get(result['source_url']).content==panels[0]
    assert result['derived_from']['document_revision']==2
    retry=post(client,payload|{'expected_recipe':NEUTRAL},master,panels);assert retry.status_code==409
    assert digest(original.read_bytes())==before and client.get(parent['source_url']).content==original.read_bytes()


def test_overlay_copy_merge_and_future_recipe_rejection_preserve_sources(client,image_factory,tmp_path):
    path=image_factory('text-copy.jpg');original=path.read_bytes();saved=create_edit(client,path,recipe=recipe());moved=tmp_path/'moved';migrate(DATA,moved)
    with sqlite3.connect(moved/'library.db') as db:
        row=db.execute('SELECT recipe,source_path FROM edit_documents WHERE id=?',(saved['id'],)).fetchone();assert json.loads(row[0])==recipe() and Path(row[1]).read_bytes()==original
    target=migrations.backup_database(DATA/'library.db',tmp_path/'target.db');incoming=migrations.backup_database(DATA/'library.db',tmp_path/'incoming.db');stage=tmp_path/'stage.db'
    merge_libraries(target,incoming,stage,tmp_path/'old',tmp_path/'new')
    with sqlite3.connect(stage) as db:assert [json.loads(r[0]) for r in db.execute('SELECT recipe FROM edit_documents')]==[recipe(),recipe()]
    with sqlite3.connect(incoming) as db:
        damaged=recipe();damaged['layer_stack']['version']=99;db.execute('UPDATE edit_documents SET recipe=?',(json.dumps(damaged),));db.commit()
    before=target.read_bytes()
    with pytest.raises(ValueError):merge_libraries(target,incoming,tmp_path/'bad-stage.db',tmp_path/'old',tmp_path/'new')
    assert target.read_bytes()==before and path.read_bytes()==original
