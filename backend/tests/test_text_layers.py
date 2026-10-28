from backend.app.migrations import SCHEMA_VERSION
import json
import sqlite3
from copy import deepcopy
from pathlib import Path
import pytest
from backend.app.config import DATA
from backend.app.editor_schemas import recipe_adapter
from backend.app.models import Session, EditDocument, AssetVariant
from backend.app import migrations
from backend.library_maintenance import merge_libraries
from backend.migrate_storage import migrate
from test_editor import NEUTRAL, create_edit, rendered, digest
from test_split import prepare, post


def recipe(width=640,height=480):
    layers=json.loads((Path(__file__).parents[2]/'frontend/tests/fixtures/text-layer-contract.json').read_text(encoding='utf-8'))
    return NEUTRAL|dict(version=3,composition=dict(source_width=width,source_height=height,angle=0),text_layers=layers)


def test_text_recipe_round_trip_legacy_downgrade_and_frozen_output(client,image_factory):
    path=image_factory('editable-text.jpg');original=path.read_bytes();r=recipe();saved=create_edit(client,path,recipe=r)
    assert saved['recipe']==r and client.get(saved['source_url']).content==original
    update=dict(revision=1,source_hash=saved['source_hash'],recipe=NEUTRAL)
    assert client.put('/api/editor/edits/'+saved['id'],json=update).status_code==409
    payload=dict(document_id=saved['id'],document_revision=1,name='text.png')
    for expected in (None,NEUTRAL):
        value=payload|({'expected_recipe':expected} if expected else {})
        assert client.post('/api/editor/variants',data={'payload':json.dumps(value)},files={'file':('text.png',rendered())}).status_code==409
    response=client.post('/api/editor/variants',data={'payload':json.dumps(payload|{'expected_recipe':r})},files={'file':('text.png',rendered())});assert response.status_code==201,response.text
    variant=response.json();changed=deepcopy(r);changed['text_layers']['layers'][0]['text']='Changed'
    response=client.put('/api/editor/edits/'+saved['id'],json=update|{'recipe':changed});assert response.status_code==200,response.text
    with Session() as session:assert session.get(AssetVariant,variant['id']).recipe==r
    assert client.post('/api/editor/variants/'+variant['id']+'/watermark').status_code==201
    empty=deepcopy(changed);empty['text_layers']['layers']=[]
    assert client.put('/api/editor/edits/'+saved['id'],json=update|{'revision':2,'recipe':empty}).status_code==200
    assert path.read_bytes()==original


def test_text_contract_rejects_unknown_versions_malformed_styles_and_limits():
    r=recipe();assert recipe_adapter.validate_python(r).model_dump(exclude_none=True)==r
    for patch in [{'font':'remote'},{'text':'bad\ud800'},{'opacity':True},{'size':10**1000},{'kind':'sticker'},{'text':'\n'*128},{'text':'👩'*4097},{'fill':{'kind':'solid','color':'url(x)','opacity':1}}]:
        invalid=deepcopy(r);invalid['text_layers']['layers'][0].update(patch)
        with pytest.raises(ValueError):recipe_adapter.validate_python(invalid)
    for v in [True,0,2,99]:
        invalid=deepcopy(r);invalid['text_layers']['version']=v
        with pytest.raises(ValueError):recipe_adapter.validate_python(invalid)
    for version in (1,2):
        with pytest.raises(ValueError):recipe_adapter.validate_python(r|{'version':version})


def test_text_split_freezes_parent_parameters_and_child_is_neutral(client,tmp_path):
    original,before,parent,payload,master,panels=prepare(client,tmp_path)
    r=recipe(payload['spec']['basis']['width'],payload['spec']['basis']['height'])
    response=client.put('/api/editor/edits/'+parent['id'],json=dict(revision=1,source_hash=before,recipe=r));assert response.status_code==200,response.text
    payload['document_revision']=2
    assert post(client,payload,master,panels).status_code==409
    payload['expected_recipe']=r;response=post(client,payload,master,panels);assert response.status_code==201,response.text
    group=response.json();assert group['parent_recipe']==r and group['recipe']['version']==2 and 'text_layers' not in group['recipe']
    from test_split_edit import child
    result=child(client,group).json();assert result['recipe']==NEUTRAL and client.get(result['source_url']).content==panels[0]
    assert result['derived_from']['document_revision']==2
    retry=post(client,payload|{'expected_recipe':NEUTRAL},master,panels);assert retry.status_code==409
    assert digest(original.read_bytes())==before and client.get(parent['source_url']).content==original.read_bytes()


def test_text_copy_merge_and_future_recipe_rejection_preserve_sources(client,image_factory,tmp_path):
    path=image_factory('text-copy.jpg');original=path.read_bytes();saved=create_edit(client,path,recipe=recipe());moved=tmp_path/'moved';migrate(DATA,moved)
    with sqlite3.connect(moved/'library.db') as db:
        row=db.execute('SELECT recipe,source_path FROM edit_documents WHERE id=?',(saved['id'],)).fetchone();assert json.loads(row[0])==recipe() and Path(row[1]).read_bytes()==original
    target=migrations.backup_database(DATA/'library.db',tmp_path/'target.db');incoming=migrations.backup_database(DATA/'library.db',tmp_path/'incoming.db');stage=tmp_path/'stage.db'
    merge_libraries(target,incoming,stage,tmp_path/'old',tmp_path/'new')
    with sqlite3.connect(stage) as db:assert [json.loads(r[0]) for r in db.execute('SELECT recipe FROM edit_documents')]==[recipe(),recipe()]
    with sqlite3.connect(incoming) as db:
        damaged=recipe();damaged['text_layers']['version']=99;db.execute('UPDATE edit_documents SET recipe=?',(json.dumps(damaged),));db.commit()
    before=target.read_bytes()
    with pytest.raises(ValueError):merge_libraries(target,incoming,tmp_path/'bad-stage.db',tmp_path/'old',tmp_path/'new')
    assert target.read_bytes()==before and path.read_bytes()==original


def test_text_schema_upgrade_is_backed_up_and_mislabeled_data_cannot_migrate(client,image_factory,tmp_path,monkeypatch):
    path=image_factory('text-upgrade.jpg');legacy=create_edit(client,path);db=DATA/'library.db'
    with sqlite3.connect(db) as con:con.execute('PRAGMA user_version=16')
    old=db.read_bytes();backup=migrations.backup_database
    monkeypatch.setattr(migrations,'backup_database',lambda *_a,**_k:(_ for _ in ()).throw(OSError('Synthetic backup failure')))
    with pytest.raises(OSError):migrations.migrate_database(db)
    assert db.read_bytes()==old
    monkeypatch.setattr(migrations,'backup_database',backup);migrations.migrate_database(db)
    with sqlite3.connect(db) as con:assert con.execute('PRAGMA user_version').fetchone()[0]==SCHEMA_VERSION
    assert client.get('/api/editor/edits/'+legacy['id']).json()['recipe']==NEUTRAL
    create_edit(client,path,recipe=recipe())
    with sqlite3.connect(db) as con:con.execute('PRAGMA user_version=16')
    before=db.read_bytes()
    with pytest.raises(ValueError):migrations.migrate_database(db)
    assert db.read_bytes()==before


def test_local_editor_fonts_and_licenses_match_bundled_bytes(client):
    assets=Path(__file__).parents[1]/'app/assets/signatures'
    for path in assets.iterdir():
        if path.suffix not in ('.ttf','.txt'):continue
        response=client.get('/local-assets/signatures/'+path.name)
        assert response.status_code==200 and response.content==path.read_bytes()
    assert client.get('/local-assets/signatures/MaShanZheng-Regular.ttf',headers={'Host':'photos.example.com'}).status_code==400
