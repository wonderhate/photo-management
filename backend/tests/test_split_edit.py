from backend.app.migrations import SCHEMA_VERSION
"""Neutral child edits retain panel bytes, lineage and safe library relationships."""
import io
import json
import sqlite3
import subprocess
import sys
from copy import deepcopy
from pathlib import Path
from uuid import uuid4
import pytest
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import Session as DatabaseSession
from backend.app.config import DATA
from backend.app.models import Session, EditDocument, AssetVariant
from backend.app.edit_lineage import SplitEditSource, neutral_recipe
from backend.app.services import editor_service, split_edit_service
from backend.app.split_schemas import SplitSpec, split_plan
from backend.app import migrations
from backend.library_maintenance import merge_libraries
from backend.migrate_storage import migrate
from test_editor import NEUTRAL, digest, create_variant
from test_split import prepare, post, image_bytes


def setup_group(client,tmp_path,format='png'):
    original,before,parent,payload,master,panels=prepare(client,tmp_path,format)
    response=post(client,payload,master,panels);assert response.status_code==201,response.text
    return original,before,parent,response.json(),panels


def child(client,group,index=0,request_id=None):
    return client.post(f'/api/editor/splits/{group["id"]}/panels/{group["panels"][index]["id"]}/edit',json={'request_id':request_id or str(uuid4())})


def test_shared_lineage_contract_and_neutral_defaults():
    fixture=json.loads((Path(__file__).parents[2]/'frontend/tests/fixtures/edit-lineage-contract.json').read_text())
    assert SplitEditSource.model_validate(fixture['valid']).model_dump()==fixture['valid']
    for patch in fixture['invalidPatches']:
        with pytest.raises(ValueError):SplitEditSource.model_validate(fixture['valid']|patch)
    for key in fixture['valid']:
        value=deepcopy(fixture['valid']);del value[key]
        with pytest.raises(ValueError):SplitEditSource.model_validate(value)
    assert neutral_recipe()==NEUTRAL


@pytest.mark.parametrize('format',['png','jpg'])
def test_child_owns_exact_panel_bytes_starts_neutral_and_retry_preserves_edits(client,tmp_path,format):
    original,before,parent,group,panels=setup_group(client,tmp_path,format)
    request_id=str(uuid4());response=child(client,group,1,request_id);assert response.status_code==201,response.text
    edit=response.json();assert edit['id']==request_id and edit['photo_id'] is None and edit['recipe']==NEUTRAL
    assert edit['decode_profile']=={'version':2,'extra_orientation':1}
    lineage=edit['derived_from'];assert lineage['document_id']==parent['id'] and lineage['document_revision']==1 and lineage['panel_index']==1
    assert lineage['parent_source_hash']==before and lineage['source_hash']==digest(panels[1]) and lineage['variant_id']==group['panels'][1]['id']
    assert client.get(edit['source_url']).content==panels[1]
    with Image.open(io.BytesIO(client.get(edit['source_url']).content)) as image:assert image.size==(lineage['width'],lineage['height'])
    with Session() as session:
        own=editor_service.source_path(session.get(EditDocument,edit['id']));panel=editor_service.variant_path(session.get(AssetVariant,lineage['variant_id']))
        assert own!=panel and own.read_bytes()==panel.read_bytes()
    assert client.put('/api/editor/edits/'+parent['id'],json={'revision':1,'source_hash':before,'recipe':NEUTRAL|{'exposure':2}}).status_code==200
    updated=client.put('/api/editor/edits/'+edit['id'],json={'revision':1,'source_hash':edit['source_hash'],'recipe':NEUTRAL|{'contrast':17}})
    assert updated.status_code==200 and updated.json()['derived_from']==lineage
    assert child(client,group,1,request_id).json()==updated.json()
    assert child(client,group,0,request_id).status_code==409
    assert client.get(edit['source_url']).content==panels[1] and digest(original.read_bytes())==before
    assert client.get('/api/photos').json()['total']==0
    assert client.delete('/api/editor/edits/'+parent['id']).status_code==409


@pytest.mark.parametrize('phase',['copy','commit'])
def test_failed_child_copy_or_commit_rolls_back_owned_snapshot_and_same_request_can_retry(client,tmp_path,monkeypatch,phase):
    original,before,parent,group,panels=setup_group(client,tmp_path);request_id=str(uuid4())
    start=set((DATA/'documents'/'edits').glob('*'))
    def fail_copy(upload,target,limit):
        target.write_bytes(panels[0][:24]);raise OSError('Synthetic copy failure')
    def fail_commit(*args,**kwargs):raise OSError('Synthetic commit failure')
    with monkeypatch.context() as patch:
        if phase=='copy':patch.setattr(editor_service,'upload_to',fail_copy)
        else:patch.setattr(DatabaseSession,'commit',fail_commit)
        with pytest.raises(OSError):child(client,group,0,request_id)
    assert set((DATA/'documents'/'edits').glob('*'))==start
    with Session() as session:assert session.get(EditDocument,request_id) is None
    assert child(client,group,0,request_id).status_code==201
    assert digest(original.read_bytes())==before


def test_changed_panel_and_unknown_child_lineage_fail_without_overwriting_any_source(client,tmp_path):
    original,before,parent,group,panels=setup_group(client,tmp_path);edit=child(client,group).json()
    with Session() as session:
        document=session.get(EditDocument,edit['id']);saved=deepcopy(document.source_json)
        panel=editor_service.variant_path(session.get(AssetVariant,group['panels'][0]['id']))
    panel.write_bytes(b'externally changed')
    assert child(client,group).status_code==409
    # Its owned snapshot remains usable even if the immutable group's file is damaged.
    assert client.get(edit['source_url']).content==panels[0]
    panel.write_bytes(panels[0])
    for patch in [{'version':2},{'panel_index':2},{'document_id':edit['id']},{'source_hash':'a'*64},{'document_revision':99}]:
        with Session() as session:
            row=session.get(EditDocument,edit['id']);row.source_json=saved|{'derived_from':saved['derived_from']|patch};session.commit()
        assert client.get('/api/editor/edits/'+edit['id']).status_code==409
        assert client.get(edit['source_url']).status_code==409
        assert client.put('/api/editor/edits/'+edit['id'],json={'revision':1,'source_hash':edit['source_hash'],'recipe':NEUTRAL}).status_code==409
    with Session() as session:row=session.get(EditDocument,edit['id']);row.source_json=saved;session.commit()
    assert client.get(edit['source_url']).content==panels[0] and digest(original.read_bytes())==before


def test_child_copy_and_collision_merge_remap_lineage_preserve_snapshots_and_watermark_references(client,tmp_path):
    original,before,parent,group,panels=setup_group(client,tmp_path);edit=child(client,group).json()
    variant=create_variant(client,edit)
    draft=client.post('/api/editor/variants/'+variant['id']+'/watermark');assert draft.status_code==201,draft.text
    assert client.delete('/api/editor/edits/'+edit['id']).status_code==409
    moved=tmp_path/'moved';migrate(DATA,moved)
    target=migrations.backup_database(DATA/'library.db',tmp_path/'target.db');incoming=migrations.backup_database(DATA/'library.db',tmp_path/'incoming.db');stage=tmp_path/'stage.db'
    merge_libraries(target,incoming,stage,tmp_path/'unused',tmp_path/'new')
    # Maintenance must not initialize the user's default application/library.
    subprocess.run([sys.executable,'-c',"import sys;from pathlib import Path;from backend.library_maintenance import merge_libraries;merge_libraries(*map(Path,sys.argv[1:]));assert 'backend.app.config' not in sys.modules;assert 'backend.app.models' not in sys.modules;assert 'fastapi' not in sys.modules",str(target),str(incoming),str(tmp_path/'cold.db'),str(tmp_path/'unused'),str(tmp_path/'new')],check=True,capture_output=True)
    for database,count in [(moved/'library.db',1),(stage,2)]:
        engine=create_engine(f'sqlite:///{database}')
        try:
            with DatabaseSession(engine) as session:
                children=[row for row in session.query(EditDocument).all() if 'derived_from' in row.source_json];assert len(children)==count
                for row in children:
                    value=split_edit_service.checked_lineage(row);assert value['parent_source_hash']==before
                    assert editor_service.source_path(row).read_bytes()==panels[0]
                    assert row.source_json['storage_id']==edit['id']
                    assert value['document_id']!=row.id and session.get(AssetVariant,value['variant_id']).document_id==value['document_id']
                if count==2:
                    assert len({row.source_json['derived_from']['group_id'] for row in children})==2
                    assert len({row.source_json['derived_from']['document_id'] for row in children})==2
            with sqlite3.connect(database) as db:
                assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
                assert db.execute('SELECT COUNT(*) FROM watermark_drafts WHERE asset_variant_id IS NOT NULL').fetchone()[0]==count
        finally:engine.dispose()
    assert digest(original.read_bytes())==before


def test_schema15_backup_precedes_lineage_upgrade_and_failure_preserves_original(client,tmp_path,monkeypatch):
    original,before,parent,group,panels=setup_group(client,tmp_path)
    path=migrations.backup_database(DATA/'library.db',tmp_path/'legacy.db')
    with sqlite3.connect(path) as db:db.execute('PRAGMA user_version=15')
    old=path.read_bytes()
    with monkeypatch.context() as patch:
        patch.setattr(migrations,'backup_database',lambda *args:(_ for _ in ()).throw(OSError('Synthetic backup failure')))
        with pytest.raises(OSError):migrations.migrate_database(path)
    assert path.read_bytes()==old
    migrations.migrate_database(path);backups=list((tmp_path/'backups').glob('*.db'));assert len(backups)==1
    with sqlite3.connect(backups[0]) as db:assert db.execute('PRAGMA user_version').fetchone()[0]==15
    with sqlite3.connect(path) as db:assert db.execute('PRAGMA user_version').fetchone()[0]==SCHEMA_VERSION
    migrations.migrate_database(path);assert len(list((tmp_path/'backups').glob('*.db')))==1
    assert digest(original.read_bytes())==before


def test_panel_import_limit_and_late_source_change_do_not_publish_a_child(client,tmp_path,monkeypatch):
    original,before,parent,group,panels=setup_group(client,tmp_path);start=set((DATA/'documents'/'edits').glob('*'))
    with monkeypatch.context() as patch:
        patch.setattr(editor_service,'MAX_SOURCE',len(panels[0])-1)
        assert child(client,group).status_code==413
    with Session() as session:panel=editor_service.variant_path(session.get(AssetVariant,group['panels'][0]['id']))
    upload=editor_service.upload_to
    def change_after_copy(*args):
        result=upload(*args);panel.write_bytes(b'externally modified panel');return result
    with monkeypatch.context() as patch:
        patch.setattr(editor_service,'upload_to',change_after_copy)
        assert child(client,group).status_code==409
    assert panel.read_bytes()==b'externally modified panel'
    assert set((DATA/'documents'/'edits').glob('*'))==start and digest(original.read_bytes())==before


def test_nested_panel_edits_keep_transitive_ancestry_and_merge_remaps_each_generation(client,tmp_path):
    original,before,parent,group,panels=setup_group(client,tmp_path);first=child(client,group).json()
    with Image.open(io.BytesIO(panels[0])) as raw:whole=raw.convert('RGBA')
    width,height=whole.size
    spec=dict(version=1,aspect=dict(width=width/2,height=height),count=2,region=dict(x=0,y=0,width=1,height=1),basis=dict(width=width,height=height),angle=0)
    plan=split_plan(SplitSpec.model_validate(spec));nested=[image_bytes(whole.crop((p['x'],0,p['x']+p['width'],height))) for p in plan['panels']]
    payload=dict(request_id=str(uuid4()),document_id=first['id'],document_revision=1,source_hash=first['source_hash'],name='child.png',spec=spec,format='png',quality=95,master_hash=digest(panels[0]),panel_hashes=[digest(p) for p in nested])
    response=post(client,payload,panels[0],nested);assert response.status_code==201,response.text
    second_group=response.json();second=child(client,second_group).json()
    assert second['derived_from']['document_id']==first['id'] and client.get(second['source_url']).content==nested[0]
    target=migrations.backup_database(DATA/'library.db',tmp_path/'target.db');incoming=migrations.backup_database(DATA/'library.db',tmp_path/'incoming.db');stage=tmp_path/'stage.db'
    merge_libraries(target,incoming,stage,tmp_path/'unused',tmp_path/'new')
    engine=create_engine(f'sqlite:///{stage}')
    try:
        with DatabaseSession(engine) as session:
            children=[row for row in session.query(EditDocument).all() if 'derived_from' in row.source_json];assert len(children)==4
            for row in children:
                value=split_edit_service.checked_lineage(row);assert value
                ancestor=session.get(EditDocument,value['document_id'])
                if 'derived_from' in ancestor.source_json:
                    assert ancestor.source_json['derived_from']['parent_source_hash']==before
                    assert editor_service.source_path(row).read_bytes()==nested[0]
    finally:engine.dispose()
    assert digest(original.read_bytes())==before


def test_merge_rejects_future_or_broken_lineage_without_changing_either_input(client,tmp_path):
    original,before,parent,group,panels=setup_group(client,tmp_path);edit=child(client,group).json()
    target=migrations.backup_database(DATA/'library.db',tmp_path/'target.db');incoming=migrations.backup_database(DATA/'library.db',tmp_path/'incoming.db')
    with sqlite3.connect(incoming) as db:
        metadata=json.loads(db.execute('SELECT source_json FROM edit_documents WHERE id=?',(edit['id'],)).fetchone()[0])
        metadata['derived_from']['version']=2;db.execute('UPDATE edit_documents SET source_json=? WHERE id=?',(json.dumps(metadata),edit['id']))
    hashes=[digest(p.read_bytes()) for p in (target,incoming)]
    with pytest.raises(ValueError):merge_libraries(target,incoming,tmp_path/'stage.db',tmp_path/'unused',tmp_path/'new')
    assert [digest(p.read_bytes()) for p in (target,incoming)]==hashes and digest(original.read_bytes())==before


def test_unrelated_group_strict_request_and_existing_folder_never_overwrite(client,tmp_path):
    original,before,parent,group,panels=setup_group(client,tmp_path)
    path=f'/api/editor/splits/{group["id"]}/panels/{group["panels"][0]["id"]}/edit'
    for data in [{'request_id':'../unsafe'},{'request_id':str(uuid4()),'recipe':NEUTRAL}]:assert client.post(path,json=data).status_code==422
    request_id=str(uuid4());folder=DATA/'documents'/'edits'/request_id;folder.mkdir();protected=folder/'source.png';protected.write_bytes(b'existing source')
    assert child(client,group,0,request_id).status_code==409 and protected.read_bytes()==b'existing source'
    response=client.post(f'/api/editor/splits/{group["id"]}/panels/{group["master"]["id"]}/edit',json={'request_id':str(uuid4())})
    assert response.status_code==409
    assert digest(original.read_bytes())==before
