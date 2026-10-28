import copy
import hashlib
import json
import sqlite3
from pathlib import Path
from uuid import uuid4
import pytest
from backend.app import collage_schemas as schema,migrations
from backend.app.config import DATA
from backend.app.models import Session,CollageProject
from backend.app.services import collage_service
from backend.migrate_storage import migrate
from backend.library_maintenance import merge_libraries

def payload(path):
    source={'id':str(uuid4()),'name':path.name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'width':640,'height':480,'bits':8,'profile':{'version':2,'extra_orientation':1}}
    scene={'version':2,'edge_blend':20,'template':'1-full','width':600,'height':400,'gap':.008,'padding':.02,'radius':.1,'background':'#f7f3eb','sources':[source],'cells':[{'source_id':source['id'],'pan':{'x':.2,'y':0},'zoom':1.2}]}
    return {'id':str(uuid4()),'request_id':str(uuid4()),'expected_revision':0,'name':'Collage project','document':{'kind':'single','value':scene}}

def save(client,value,path):return client.post('/api/editor/collages',data={'payload':json.dumps(value)},files=[('files',(path.name,path.read_bytes(),'application/octet-stream'))])

def test_collage_contract_templates_versions_geometry_and_unknown_fields():
    templates=json.loads((Path(__file__).parents[2]/'frontend/src/core/collage-templates.json').read_text('utf-8'))
    assert schema.TEMPLATES=={t['id']:t['cells'] for t in templates}
    base={'id':'s','name':'a.png','sha256':'a'*64,'width':640,'height':480,'bits':8,'profile':{'version':2,'extra_orientation':1}}
    for template in templates:
        sources=[base|{'id':f's-{i}'} for i in range(len(template['cells']))]
        scene={'version':2,'edge_blend':18,'template':template['id'],'width':317,'height':211,'gap':.008,'padding':.02,'radius':.1,'background':'#f7f3eb','sources':sources,'cells':[{'source_id':s['id'],'pan':{'x':0,'y':0},'zoom':1} for s in sources]};schema.scene(scene)
        for patch in ({'version':1},{'edge_blend':10001},{'width':False},{'secret':1},{'cells':[]}):
            with pytest.raises(ValueError):schema.scene(scene|patch)

def test_collage_save_retry_revision_source_reuse_and_readonly_delete(client,image_factory):
    path=image_factory('collage-original.png');before=path.read_bytes();value=payload(path);response=save(client,value,path);assert response.status_code==201,response.text
    record=response.json();schema.record(record);assert record['revision']==1
    with Session() as session:assets=copy.deepcopy(session.get(CollageProject,value['id']).assets)
    assert save(client,value,path).json()==record
    changed=copy.deepcopy(value);changed.update(expected_revision=1,request_id=str(uuid4()),name='Updated');changed['document']['value']['cells'][0]['zoom']=1.5
    updated=save(client,changed,path);assert updated.status_code==201,updated.text;assert updated.json()['revision']==2
    with Session() as session:assert session.get(CollageProject,value['id']).assets==assets
    stale=copy.deepcopy(changed);stale['request_id']=str(uuid4());assert save(client,stale,path).status_code==409
    source=value['document']['value']['sources'][0];url=f"/api/editor/collages/{value['id']}/sources/{source['id']}"
    assert client.get(url+'?revision=1').status_code==409;assert client.get(url+'?revision=2').content==before
    assert client.get('/api/editor/collages').json()['items'][0]['name']=='Updated'
    assert client.delete(f"/api/editor/collages/{value['id']}?revision=1").status_code==409
    assert client.delete(f"/api/editor/collages/{value['id']}?revision=2").status_code==200
    assert path.read_bytes()==before and all(Path(a['path']).read_bytes()==before for a in assets.values())

def test_collage_bad_hash_commit_failure_existing_directory_and_damage(client,image_factory,monkeypatch):
    path=image_factory('collage-failure.png');value=payload(path);bad=copy.deepcopy(value);bad['document']['value']['sources'][0]['sha256']='f'*64;assert save(client,bad,path).status_code==409
    parent=DATA/'documents'/'collages';existing=parent/value['request_id'];existing.mkdir(parents=True);assert save(client,value,path).status_code==409;assert existing.is_dir()
    existing.rmdir()
    from sqlalchemy.orm import Session as OrmSession
    original=OrmSession.commit
    def fail(_):raise OSError('Synthetic collage commit failure')
    monkeypatch.setattr(OrmSession,'commit',fail)
    with pytest.raises(OSError):save(client,value,path)
    assert not existing.exists()
    monkeypatch.setattr(OrmSession,'commit',original);assert save(client,value,path).status_code==201
    with Session() as session:asset=next(iter(session.get(CollageProject,value['id']).assets.values()))
    Path(asset['path']).write_bytes(b'damaged');assert client.get('/api/editor/collages/'+value['id']).status_code==409
    assert hashlib.sha256(path.read_bytes()).hexdigest()==value['document']['value']['sources'][0]['sha256']

def test_collage_schema_backup_copy_merge_and_mislabeled_version(client,image_factory,tmp_path,monkeypatch):
    path=image_factory('collage-move.png');value=payload(path);assert save(client,value,path).status_code==201
    old=migrations.backup_database(DATA/'library.db',tmp_path/'old.db')
    with sqlite3.connect(old) as db:db.execute('DROP TABLE collage_projects');db.execute('PRAGMA user_version=21')
    before=old.read_bytes();backup=migrations.backup_database
    def fail(*a,**k):raise OSError('Synthetic collage backup failure')
    monkeypatch.setattr(migrations,'backup_database',fail)
    with pytest.raises(OSError):migrations.migrate_database(old)
    assert old.read_bytes()==before
    monkeypatch.setattr(migrations,'backup_database',backup);migrations.migrate_database(old)
    with sqlite3.connect(old) as db:assert db.execute('PRAGMA user_version').fetchone()[0]==migrations.SCHEMA_VERSION;assert db.execute('SELECT count(*) FROM collage_projects').fetchone()[0]==0
    moved=tmp_path/'moved';migrate(DATA,moved)
    with sqlite3.connect(moved/'library.db') as db:
        assets=json.loads(db.execute('SELECT assets FROM collage_projects').fetchone()[0]);assert all(Path(a['path']).is_relative_to(moved) and Path(a['path']).read_bytes()==path.read_bytes() for a in assets.values())
    target=backup(DATA/'library.db',tmp_path/'target.db');incoming=backup(DATA/'library.db',tmp_path/'incoming.db');stage=tmp_path/'merged.db';merge_libraries(target,incoming,stage,tmp_path/'old',tmp_path/'new')
    with sqlite3.connect(stage) as db:
        rows=db.execute('SELECT id,record FROM collage_projects').fetchall();assert len(rows)==2 and len({r[0] for r in rows})==2
        for id,record in rows:assert json.loads(record)['id']==id;schema.record(json.loads(record))
    with sqlite3.connect(incoming) as db:db.execute('PRAGMA user_version=21')
    before=incoming.read_bytes()
    with pytest.raises(ValueError):migrations.migrate_database(incoming)
    assert incoming.read_bytes()==before


def test_collage_photo_links_survive_record_removal_with_owned_sources(client,image_factory):
    from test_library import import_paths
    path=image_factory('linked-collage.jpg');before=path.read_bytes();import_paths(client,[path]);photo=client.get('/api/photos').json()['photos'][0]
    value=payload(path);source=value['document']['value']['sources'][0];source['photo_id']=photo['id']
    record=save(client,value,path).json();assert record['photo_links']==[{'source_id':source['id'],'photo_id':photo['id']}]
    assert client.delete('/api/photos/'+photo['id']).status_code==200
    assert client.get('/api/editor/collages/'+record['id']).status_code==200
    assert client.get(f"/api/editor/collages/{record['id']}/sources/{source['id']}?revision=1").content==before
    value.update(expected_revision=1,request_id=str(uuid4()));updated=save(client,value,path);assert updated.status_code==201;assert updated.json()['photo_links']==[]
    assert path.read_bytes()==before


def test_collage_project_literal_search_paging_sort_and_preference_validation(client,image_factory):
    path=image_factory('project-search.jpg');before=path.read_bytes()
    for i in range(23):
        value=payload(path);value['name']=('Alpha_% ' if i<21 else 'Other ')+str(i).zfill(2);assert save(client,value,path).status_code==201
    first=client.get('/api/editor/collages',params={'search':'ALPHA_%','sort':'name','direction':'asc'}).json()
    second=client.get('/api/editor/collages',params={'search':'ALPHA_%','sort':'name','direction':'asc','page':2}).json()
    assert first['total']==second['total']==21 and len(first['items'])==20 and len(second['items'])==1
    assert first['items'][0]['name']=='Alpha_% 00' and second['items'][0]['name']=='Alpha_% 20'
    assert client.get('/api/editor/collages',params={'search':'absent'}).json()['total']==0
    assert client.get('/api/editor/collages',params={'sort':'path'}).status_code==422
    identity=client.get('/api/workspace').json()['library_id'];canvas={'width':640,'height':480,'gap':.01,'padding':.02,'radius':0,'background':'#123456','edge_blend':12}
    def pref(kind,values):return client.patch('/api/workspace/tools/'+kind,json={'library_id':identity,'values':values})
    assert pref('collage',{'canvas':canvas,'format':'webp','quality':81,'showGuides':False}).status_code==200
    assert pref('collageBatch',{'size':6,'order':'filename','remainder':'drop','format':'webp','quality':70}).status_code==200
    for v in [{'canvas':canvas|{'width':12000,'height':12000}},{'canvas':canvas|{'version':2}},{'format':'exe'},{'showGuides':1},{'quality':True},{'sources':[]}]:assert pref('collage',v).status_code==422
    for v in [{'size':True},{'size':5},{'size':'4'},{'order':'random'},{'remainder':'delete'}]:assert pref('collageBatch',v).status_code==422
    assert client.get('/api/workspace').json()['tool_preferences']['collage']['canvas']==canvas
    assert path.read_bytes()==before
