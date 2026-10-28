from backend.app.migrations import SCHEMA_VERSION
"""Real files/SQLite regressions for the local, non-destructive darkroom."""
import hashlib
import io
import json
import sqlite3
from pathlib import Path
import pytest
from PIL import Image
from backend.app.config import DATA
from backend.app.models import Session, EditDocument, AssetVariant
from backend.app.migrations import backup_database, migrate_database
from backend.app.services import editor_service, export_registry
from backend.library_maintenance import merge_libraries
from backend.migrate_storage import migrate
from test_library import import_paths


NEUTRAL = dict(version=1,exposure=0,contrast=0,highlights=0,shadows=0,temperature=0,tint=0,
    saturation=0,hue=0,hslSaturation=0,lightness=0,curve=[0,.25,.5,.75,1],rotation=0,
    flipX=False,flipY=False,crop=dict(x=0,y=0,width=1,height=1),sharpen=0,denoise=0,
    match=0,preserveLuminance=True)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def create_edit(client, path, photo_id=None, **changes):
    payload=dict(source_name=path.name,source_hash=digest(path.read_bytes()),recipe=NEUTRAL)
    if photo_id: payload['photo_id']=photo_id
    response=client.post('/api/editor/edits',data={'payload':json.dumps(payload|changes)},
        files={'file':(path.name,path.read_bytes(),'application/octet-stream')})
    assert response.status_code==201,response.text
    return response.json()


def rendered():
    stream=io.BytesIO()
    Image.new('RGB',(96,64),(30,90,170)).save(stream,'PNG')
    return stream.getvalue()


def create_variant(client, edit, data=None, **changes):
    payload=dict(document_id=edit['id'],document_revision=edit['revision'],name='修图作品.png')|changes
    response=client.post('/api/editor/variants',data={'payload':json.dumps(payload)},
        files={'file':('render.png',data or rendered(),'image/png')})
    assert response.status_code==201,response.text
    return response.json()


def test_saved_parameters_survive_original_removal_with_revision_checks(client,image_factory):
    original=image_factory('read-only-original.jpg');before=original.read_bytes()
    import_paths(client,[original]);photo=client.get('/api/photos').json()['photos'][0]
    edit=create_edit(client,original,photo['id'])
    assert edit['pipeline_version']=='pc-edit-v1' and edit['revision']==1
    assert 'source_path' not in edit
    assert client.get(edit['source_url']).content==before
    payload=dict(revision=1,source_hash=edit['source_hash'],recipe=NEUTRAL|{'exposure':1.25})
    changed=client.put('/api/editor/edits/'+edit['id'],json=payload)
    assert changed.status_code==200 and changed.json()['revision']==2
    assert client.put('/api/editor/edits/'+edit['id'],json=payload).status_code==409
    assert client.get('/api/editor/edits/'+edit['id']).json()['recipe']['exposure']==1.25
    assert client.delete('/api/photos/'+photo['id']).status_code==200
    restored=client.get('/api/editor/edits/'+edit['id']).json()
    assert restored['photo_id']==photo['id'] and restored['revision']==2
    assert client.get(restored['source_url']).content==before
    assert original.read_bytes()==before


def test_source_decode_profile_is_immutable_and_legacy_records_keep_identity(client,image_factory):
    path=image_factory('decode-profile.jpg');before=digest(path.read_bytes())
    legacy=create_edit(client,path)
    with Session() as session:
        document=session.get(EditDocument,legacy['id']);document.source_json={k:v for k,v in document.source_json.items() if k!='decode_profile'};session.commit()
    restored=client.get('/api/editor/edits/'+legacy['id']).json()
    assert restored['decode_profile']=={'version':1,'extra_orientation':1} and restored['pipeline_version']=='pc-edit-v1'
    profile={'version':2,'extra_orientation':6};edit=create_edit(client,path,decode_profile=profile)
    assert edit['decode_profile']==profile and edit['pipeline_version']=='pc-edit-v2'
    payload=dict(revision=1,source_hash=edit['source_hash'],recipe=NEUTRAL|{'exposure':1})
    assert client.put('/api/editor/edits/'+edit['id'],json=payload|{'decode_profile':{'version':1,'extra_orientation':1}}).status_code==422
    changed=client.put('/api/editor/edits/'+edit['id'],json=payload).json()
    assert changed['revision']==2 and changed['decode_profile']==profile
    variant=create_variant(client,changed)
    assert variant['pipeline_version']=='pc-edit-v2' and variant['decode_profile']==profile
    with Session() as session:
        document=session.get(EditDocument,edit['id']);document.source_json={**document.source_json,'decode_profile':{'version':99,'extra_orientation':1}};session.commit()
    assert client.get('/api/editor/edits/'+edit['id']).status_code==409
    assert client.put('/api/editor/edits/'+edit['id'],json=payload|{'revision':2}).status_code==409
    assert digest(path.read_bytes())==before


@pytest.mark.parametrize('profile',[None,{},[],{'version':True,'extra_orientation':1},
    {'version':2,'extra_orientation':True},{'version':1,'extra_orientation':6},
    {'version':3,'extra_orientation':1},{'version':2,'extra_orientation':'6'},
    {'version':2,'extra_orientation':9},{'version':2,'extra_orientation':1,'unknown':True}])
def test_invalid_source_profiles_fail_before_creating_snapshots(client,image_factory,profile):
    path=image_factory();before=path.read_bytes()
    folders=set((DATA/'documents'/'edits').glob('*'))
    payload=dict(source_name=path.name,source_hash=digest(before),recipe=NEUTRAL,decode_profile=profile)
    response=client.post('/api/editor/edits',data={'payload':json.dumps(payload)},files={'file':(path.name,before)})
    assert response.status_code==422 and 'input' not in response.json()
    assert set((DATA/'documents'/'edits').glob('*'))==folders and path.read_bytes()==before


def test_schema3_semantic_upgrade_backs_up_without_rewriting_legacy_records(tmp_path,monkeypatch):
    from backend.app import migrations
    path=tmp_path/'version3.db'
    with sqlite3.connect(path) as db:db.execute('CREATE TABLE photos(id TEXT PRIMARY KEY)')
    migrate_database(path,backup=False)
    with sqlite3.connect(path) as db:
        db.execute('PRAGMA user_version=3');db.execute("INSERT INTO photos(id) VALUES ('original-id')")
    old=path.read_bytes();assert migrate_database(path)==['source_decode_profile:v2']
    backups=list((tmp_path/'backups').glob('*.db'));assert len(backups)==1
    with sqlite3.connect(backups[0]) as db:
        assert db.execute('PRAGMA user_version').fetchone()[0]==3
        assert db.execute('SELECT id FROM photos').fetchone()[0]=='original-id'
    assert migrate_database(path)==[] and len(list((tmp_path/'backups').glob('*.db')))==1
    with sqlite3.connect(path) as db:assert db.execute('PRAGMA user_version').fetchone()[0]==SCHEMA_VERSION
    protected=tmp_path/'backup-failure.db';protected.write_bytes(old)
    def refused(*args,**kwargs):raise OSError('synthetic backup failure')
    monkeypatch.setattr(migrations,'backup_database',refused)
    with pytest.raises(OSError):migrate_database(protected)
    assert protected.read_bytes()==old


@pytest.mark.parametrize('change',[{'version':2},{'version':True},{'rotation':False},
    {'curve':[0,.5,2,.8,1]},{'crop':dict(x=.7,y=0,width=.6,height=1)},{'unknown':True}])
def test_invalid_recipe_is_rejected_without_snapshot(client,image_factory,change):
    path=image_factory();payload=dict(source_name=path.name,source_hash=digest(path.read_bytes()),recipe=NEUTRAL|change)
    before=set((DATA/'documents').rglob('*')) if (DATA/'documents').exists() else set()
    response=client.post('/api/editor/edits',data={'payload':json.dumps(payload)},files={'file':(path.name,path.read_bytes())})
    assert response.status_code==422 and 'input' not in response.json()
    assert (set((DATA/'documents').rglob('*')) if (DATA/'documents').exists() else set())==before


def test_stale_and_tampered_sources_never_change_original(client,image_factory):
    path=image_factory();before=path.read_bytes();import_paths(client,[path])
    photo=client.get('/api/photos').json()['photos'][0]
    edit=create_edit(client,path,photo['id'])
    folders=set((DATA/'documents'/'edits').iterdir())
    payload=dict(photo_id=photo['id'],source_name=path.name,source_hash='0'*64,recipe=NEUTRAL)
    response=client.post('/api/editor/edits',data={'payload':json.dumps(payload)},files={'file':(path.name,before)})
    assert response.status_code==409 and set((DATA/'documents'/'edits').iterdir())==folders
    with Session() as session: snapshot=Path(session.get(EditDocument,edit['id']).source_path)
    snapshot.write_bytes(b'corrupt managed snapshot')
    assert client.get(edit['source_url']).status_code==409
    assert client.put('/api/editor/edits/'+edit['id'],json=dict(revision=1,source_hash=edit['source_hash'],recipe=NEUTRAL)).status_code==409
    variants_before=set((DATA/'assets'/'variants').glob('*'))
    response=client.post('/api/editor/variants',data={'payload':json.dumps(dict(document_id=edit['id'],document_revision=1,name='copy'))},files={'file':('copy.png',rendered())})
    assert response.status_code==409
    assert set((DATA/'assets'/'variants').glob('*'))==variants_before
    assert path.read_bytes()==before


def test_render_versions_stay_separate_from_captures_and_feed_watermark(client,image_factory,tmp_path,monkeypatch):
    original=image_factory();before=digest(original.read_bytes());import_paths(client,[original])
    photo=client.get('/api/photos').json()['photos'][0];edit=create_edit(client,original,photo['id'])
    pixels=rendered();first=create_variant(client,edit,pixels);second=create_variant(client,edit,pixels)
    assert first['id']!=second['id'] and first['file_hash']==second['file_hash']==digest(pixels)
    assert client.get('/api/photos').json()['total']==1
    assert client.get('/api/editor/variants').json()['total']==2
    assert client.get(first['preview_url']).content==pixels
    draft=client.post('/api/editor/variants/'+first['id']+'/watermark')
    assert draft.status_code==201,draft.text
    draft=draft.json()
    assert draft['asset_variant_id']==first['id'] and draft['photo_id'] is None
    assert draft['source']['camera_model']=='ILCE-7M4'
    assert client.get(draft['preview_url']).status_code==200
    assert client.put('/api/watermark/drafts/'+draft['id'],json={'revision':draft['revision'],'name':'我的编辑副本'}).status_code==200
    duplicate=client.post('/api/watermark/drafts/'+draft['id']+'/duplicate').json()
    assert duplicate['asset_variant_id']==first['id'] and not duplicate['source_missing']
    assert client.post('/api/watermark/drafts/'+draft['id']+'/relocate',json={'path':str(original)}).status_code==409
    from backend.app.services import watermark_service
    monkeypatch.setattr(watermark_service,'EXPORTS',tmp_path/'exports')
    result=client.post('/api/watermark/drafts/'+draft['id']+'/export',json={})
    assert result.status_code==200,result.text
    assert client.get(result.json()['url']).status_code==200
    assert client.delete('/api/editor/edits/'+edit['id']).status_code==409
    with Session() as session: variant_file=Path(session.get(AssetVariant,first['id']).file_path)
    variant_file.write_bytes(b'tampered copy')
    assert client.get(first['preview_url']).status_code==409
    assert client.post('/api/watermark/drafts/'+draft['id']+'/export',json={}).status_code==409
    assert digest(original.read_bytes())==before


def test_export_uses_exact_encoder_bytes_and_never_overwrites(client,image_factory,tmp_path,monkeypatch):
    exports=tmp_path/'exports';exports.mkdir();protected=exports/'作品.png';protected.write_bytes(b'existing user file')
    monkeypatch.setattr(editor_service,'EXPORTS',exports);monkeypatch.setattr(export_registry,'EXPORTS',exports)
    pixels=rendered()
    for i in range(2):
        response=client.post('/api/editor/exports',data={'name':'作品.png'},files={'file':('copy.png',pixels)})
        assert response.status_code==201,response.text
        result=response.json();assert result['file_name']==f'作品_{i+1}.png'
        assert client.get(result['url']).content==pixels
    monkeypatch.setattr(editor_service,'MAX_RENDER',2)
    response=client.post('/api/editor/exports',data={'name':'作品.png'},files={'file':('copy.png',pixels)})
    assert response.status_code==413
    assert {p.name for p in exports.iterdir()}=={'作品.png','作品_1.png','作品_2.png'}
    assert protected.read_bytes()==b'existing user file'
    assert client.get('/api/exports/作品.png').status_code==404


def test_edit_storage_copy_and_merge_keep_snapshots_and_variant_links(client,image_factory,tmp_path):
    original=image_factory();before=digest(original.read_bytes());profile={'version':2,'extra_orientation':6};edit=create_edit(client,original,decode_profile=profile)
    variant=create_variant(client,edit);draft=client.post('/api/editor/variants/'+variant['id']+'/watermark').json()
    with Session() as session:
        source=Path(session.get(EditDocument,edit['id']).source_path)
        image=Path(session.get(AssetVariant,variant['id']).file_path)
    moved=tmp_path/'moved-library';migrate(DATA,moved)
    with sqlite3.connect(moved/'library.db') as db:
        copied_source=Path(db.execute('SELECT source_path FROM edit_documents').fetchone()[0])
        copied_image=Path(db.execute('SELECT file_path FROM asset_variants').fetchone()[0])
        assert copied_source.is_relative_to(moved) and copied_source.read_bytes()==source.read_bytes()
        assert copied_image.is_relative_to(moved) and copied_image.read_bytes()==image.read_bytes()
        assert json.loads(db.execute('SELECT source_json FROM edit_documents').fetchone()[0])['decode_profile']==profile
        assert json.loads(db.execute('SELECT source_json FROM asset_variants').fetchone()[0])['decode_profile']==profile
        assert Path(json.loads(db.execute('SELECT source_json FROM watermark_drafts').fetchone()[0])['file_path'])==copied_image
    # Deliberately collide logical IDs; immutable storage tokens must not be remapped.
    target=backup_database(DATA/'library.db',tmp_path/'target.db')
    source_db=backup_database(DATA/'library.db',tmp_path/'incoming.db')
    stage=tmp_path/'stage.db';merge_libraries(target,source_db,stage,tmp_path/'other',tmp_path/'new')
    with sqlite3.connect(stage) as db:
        docs=db.execute('SELECT id,source_path,source_json FROM edit_documents').fetchall()
        variants=db.execute('SELECT id,document_id,file_path,source_json FROM asset_variants').fetchall()
        drafts=db.execute('SELECT asset_variant_id,source_json FROM watermark_drafts').fetchall()
        assert len(docs)==len(variants)==len(drafts)==2
        assert len({v[1] for v in variants})==2
        assert {d[0] for d in drafts}=={v[0] for v in variants}
        assert all(json.loads(d[1])['asset_variant_id']==d[0] for d in drafts)
        assert all(json.loads(d[2])['storage_id']==edit['id'] for d in docs)
        assert all(json.loads(v[3])['storage_id']==variant['id'] for v in variants)
        assert all(json.loads(d[2])['decode_profile']==profile for d in docs)
        assert all(json.loads(v[3])['decode_profile']==profile for v in variants)
        assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
    assert source.is_file() and image.is_file() and digest(original.read_bytes())==before


def test_future_schema_and_failed_ddl_leave_database_intact(tmp_path,monkeypatch):
    from backend.app import migrations
    path=tmp_path/'future.db'
    with sqlite3.connect(path) as db:
        db.execute('CREATE TABLE photos(id TEXT PRIMARY KEY)');db.execute('PRAGMA user_version=999')
    before=path.read_bytes()
    with pytest.raises(ValueError): migrate_database(path)
    assert path.read_bytes()==before and not (tmp_path/'backups').exists()
    with sqlite3.connect(path) as db: db.execute('PRAGMA user_version=0')
    monkeypatch.setattr(migrations,'CREATIONS',migrations.CREATIONS|{'broken':'CREATE invalid syntax'})
    with pytest.raises(sqlite3.OperationalError): migrate_database(path)
    with sqlite3.connect(path) as db:
        assert {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}=={'photos'}
        assert db.execute('PRAGMA user_version').fetchone()[0]==0


def test_edit_listing_pages_escape_search_and_delete_only_records(client,image_factory):
    path=image_factory('page_%_source.jpg');before=path.read_bytes()
    edits=[create_edit(client,path,source_name=f'page_%_{i}.jpg') for i in range(21)]
    first=client.get('/api/editor/edits?page_size=20').json()
    second=client.get('/api/editor/edits?page_size=20&page=2').json()
    assert first['total']==second['total']==21 and len(first['edits'])==20 and len(second['edits'])==1
    assert {edit['id'] for edit in first['edits']}.isdisjoint({second['edits'][0]['id']})
    assert client.get('/api/editor/edits?search=%25_').json()['total']==21
    removed=edits[0];assert client.delete('/api/editor/edits/'+removed['id']).status_code==200
    assert client.get('/api/editor/edits/'+removed['id']).status_code==404
    with Session() as session: assert session.get(EditDocument,removed['id']) is None
    assert (DATA/'documents'/'edits'/removed['id']).is_dir()
    assert path.read_bytes()==before


def test_fresh_database_records_schema_version_before_first_restart(tmp_path,monkeypatch):
    from backend.app import models,migrations
    from sqlalchemy import create_engine
    fresh=tmp_path/'new-library';fresh.mkdir()
    isolated=create_engine(f'sqlite:///{fresh/"library.db"}')
    monkeypatch.setattr(models,'DATA',fresh);monkeypatch.setattr(models,'engine',isolated)
    try:
        models.initialize()
        with sqlite3.connect(fresh/'library.db') as db:
            assert db.execute('PRAGMA user_version').fetchone()[0]==migrations.SCHEMA_VERSION
            assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
        assert not (fresh/'backups').exists()
    finally: isolated.dispose()
