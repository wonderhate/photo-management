"""Versioned composition contracts; real snapshots, no original writes."""
import json
import sqlite3
from copy import deepcopy
from pathlib import Path
import pytest
from backend.app.config import DATA
from backend.app.models import Session, EditDocument, AssetVariant
from backend.app.editor_schemas import recipe_adapter
from backend.app.migrations import backup_database
from backend.migrate_storage import migrate
from backend.library_maintenance import merge_libraries
from test_editor import NEUTRAL, create_edit, create_variant, digest, rendered


def recipe():
    # A legal rotated rectangle extending past the unrotated box.
    return NEUTRAL|dict(version=2,crop=dict(x=-.01,y=.485,width=1.02,height=.03),
        composition=dict(source_width=640,source_height=480,angle=20))


def test_v2_round_trip_keeps_legacy_parameters_source_profiles_and_variant_provenance(client,image_factory):
    path=image_factory('composition.jpg');before=path.read_bytes();legacy=create_edit(client,path)
    current=create_edit(client,path,recipe=recipe(),decode_profile=dict(version=2,extra_orientation=1))
    assert current['recipe']==recipe() and current['pipeline_version']=='pc-edit-v2'
    payload=dict(revision=legacy['revision'],source_hash=legacy['source_hash'],recipe=recipe())
    updated=client.put('/api/editor/edits/'+legacy['id'],json=payload);assert updated.status_code==200
    changed=updated.json();assert changed['recipe']==recipe() and changed['decode_profile']==legacy['decode_profile'] and changed['pipeline_version']=='pc-edit-v1'
    assert client.put('/api/editor/edits/'+legacy['id'],json=payload).status_code==409
    variant=create_variant(client,changed)
    assert client.get('/api/editor/variants/'+variant['id']).json()['recipe']==recipe()
    assert client.get(changed['source_url']).content==before and path.read_bytes()==before
    # Recipe v2 and source-decode v2 are independent contracts.
    with Session() as session:assert session.get(EditDocument,current['id']).source_json['decode_profile']==dict(version=2,extra_orientation=1)


@pytest.mark.parametrize('kind',['future','mislabeled','angle','nan','boolean','pixels','extra','outside','aspect','null-aspect'])
def test_invalid_geometry_fails_before_snapshots_and_retains_originals(client,image_factory,kind):
    r=deepcopy(recipe())
    if kind=='future':r['version']=3
    elif kind=='mislabeled':r['version']=1
    elif kind=='angle':r['composition']['angle']=45.1
    elif kind=='nan':r['composition']['angle']=float('nan')
    elif kind=='boolean':r['composition']['source_width']=True
    elif kind=='pixels':r['composition'].update(source_width=100001,source_height=1000)
    elif kind=='extra':r['composition']['unknown']=1
    elif kind=='outside':r['crop']['x']=-3
    elif kind=='aspect':r['composition']['aspect']=1
    elif kind=='null-aspect':r['composition']['aspect']=None
    with pytest.raises(ValueError):recipe_adapter.validate_python(r)
    path=image_factory('protected.jpg');before=path.read_bytes();folders=set((DATA/'documents'/'edits').glob('*'))
    payload=dict(source_name=path.name,source_hash=digest(before),recipe=r)
    response=client.post('/api/editor/edits',data={'payload':json.dumps(payload)},files={'file':(path.name,before)})
    assert response.status_code==422 and 'input' not in response.json()
    assert set((DATA/'documents'/'edits').glob('*'))==folders and path.read_bytes()==before


def test_future_stored_recipe_cannot_be_overwritten_or_used_for_a_new_variant(client,image_factory):
    path=image_factory('future-composition.jpg');before=path.read_bytes();edit=create_edit(client,path,recipe=recipe())
    with Session() as session:
        saved=session.get(EditDocument,edit['id']);saved.recipe=recipe()|{'version':9};session.commit();protected=deepcopy(saved.recipe);source=Path(saved.source_path)
    assert client.get('/api/editor/edits/'+edit['id']).status_code==409
    assert client.put('/api/editor/edits/'+edit['id'],json=dict(revision=1,source_hash=edit['source_hash'],recipe=NEUTRAL)).status_code==409
    response=client.post('/api/editor/variants',data={'payload':json.dumps(dict(document_id=edit['id'],document_revision=1,name='future.png'))},files={'file':('future.png',rendered())})
    assert response.status_code==409
    with Session() as session:
        saved=session.get(EditDocument,edit['id']);assert saved.recipe==protected and saved.revision==1
        assert session.query(AssetVariant).count()==0
    assert path.read_bytes()==source.read_bytes()==before


def test_copy_and_merge_keep_v2_parameters_legacy_records_and_immutable_sources(client,image_factory,tmp_path):
    path=image_factory('copy-composition.jpg');before=path.read_bytes();legacy=create_edit(client,path);current=create_edit(client,path,recipe=recipe());variant=create_variant(client,current)
    moved=tmp_path/'moved';migrate(DATA,moved)
    with sqlite3.connect(moved/'library.db') as db:
        docs=db.execute('SELECT source_path,recipe FROM edit_documents').fetchall();assert {json.loads(r)['version'] for _,r in docs}=={1,2}
        assert all(Path(p).read_bytes()==before for p,_ in docs)
        assert json.loads(db.execute('SELECT recipe FROM asset_variants').fetchone()[0])==recipe()
    target=backup_database(DATA/'library.db',tmp_path/'target.db');incoming=backup_database(DATA/'library.db',tmp_path/'incoming.db');stage=tmp_path/'stage.db'
    merge_libraries(target,incoming,stage,tmp_path/'other',tmp_path/'new')
    with sqlite3.connect(stage) as db:
        rows=db.execute('SELECT id,recipe,source_path,source_hash FROM edit_documents').fetchall();assert len(rows)==4
        assert sorted(json.loads(r)['version'] for _,r,_,_ in rows)==[1,1,2,2]
        assert all(Path(p).read_bytes()==before and h==digest(before) for _,_,p,h in rows)
        copies=db.execute('SELECT document_id,recipe FROM asset_variants').fetchall();assert len(copies)==2
        assert len({p for p,_ in copies})==2 and all(json.loads(r)==recipe() for _,r in copies)
        assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
    assert path.read_bytes()==before and legacy['recipe']==NEUTRAL and variant['document_id']==current['id']
