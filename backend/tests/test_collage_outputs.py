import copy
import hashlib
import io
import json
import sqlite3
from pathlib import Path
from uuid import uuid4
import pytest
from PIL import Image
from backend.app import migrations,collage_output_schemas as schema
from backend.app.config import DATA
from backend.app.models import Session,CollageOutput
from backend.migrate_storage import migrate
from backend.library_maintenance import merge_libraries
from test_collage_projects import payload,save as save_project

def output(project,format='png',size=(600,400)):
    stream=io.BytesIO();Image.new('RGB',size,(171,96,51)).save(stream,format={'png':'PNG','jpg':'JPEG','webp':'WEBP'}[format]);data=stream.getvalue()
    value={'id':str(uuid4()),'project_id':project['id'],'project_revision':1,'page':0,'format':format,'quality':90,'sha256':hashlib.sha256(data).hexdigest()}
    return value,data

def save(client,v,data):return client.post('/api/editor/collage-outputs',data={'payload':json.dumps(v)},files={'file':('output.'+v['format'],data,'image/'+v['format'])})

def test_collage_output_freezes_revision_download_and_source_after_project_delete(client,image_factory):
    original=image_factory('output-original.png');before=original.read_bytes();project=payload(original);assert save_project(client,project,original).status_code==201
    v,data=output(project,'webp');r=save(client,v,data);assert r.status_code==201,r.text;record=r.json();schema.record(record);assert save(client,v,data).json()==record
    changed=copy.deepcopy(project);changed.update(expected_revision=1,request_id=str(uuid4()));changed['document']['value']['width']=800;assert save_project(client,changed,original).status_code==201
    assert save(client,v,data).json()==record
    assert save(client,v|{'id':str(uuid4())},data).status_code==409
    assert client.delete('/api/editor/collages/'+project['id']+'?revision=2').status_code==200
    base='/api/editor/collage-outputs/'+v['id'];assert client.get(base).json()==record;assert client.get(base+'/image').content==data
    assert client.get(base+'/sources/'+project['document']['value']['sources'][0]['id']).content==before
    with Session() as session:path=Path(session.get(CollageOutput,v['id']).file_path)
    assert client.delete(base).status_code==200;assert client.get(base).status_code==404;assert path.read_bytes()==data;assert original.read_bytes()==before

def test_collage_output_rejects_wrong_hash_format_size_page_and_reused_request(client,image_factory):
    original=image_factory('output-validation.png');project=payload(original);save_project(client,project,original);v,data=output(project)
    for patch,status in [({'sha256':'f'*64},409),({'format':'webp'},422),({'page':1},422),({'quality':True},422),({'project_revision':True},422),({'secret':'private'},422)]:assert save(client,v|patch,data).status_code==status
    wrong,bytes=output(project,size=(601,400));assert save(client,wrong,bytes).status_code==422
    assert save(client,v,data).status_code==201;assert save(client,v|{'quality':89},data).status_code==409
    with Session() as session:path=Path(session.get(CollageOutput,v['id']).file_path)
    path.write_bytes(b'damaged');assert client.get('/api/editor/collage-outputs/'+v['id']+'/image').status_code==409

def test_collage_output_failed_publication_only_cleans_new_files(client,image_factory,monkeypatch):
    original=image_factory('output-rollback.png');project=payload(original);save_project(client,project,original);v,data=output(project)
    from sqlalchemy.orm import Session as OrmSession
    commit=OrmSession.commit
    def fail(_):raise OSError('Synthetic output commit failure')
    monkeypatch.setattr(OrmSession,'commit',fail)
    with pytest.raises(OSError):save(client,v,data)
    assert not (DATA/'documents'/'collage-outputs'/v['id']).exists()
    monkeypatch.setattr(OrmSession,'commit',commit);assert save(client,v,data).status_code==201
    assert hashlib.sha256(original.read_bytes()).hexdigest()==project['document']['value']['sources'][0]['sha256']

def test_collage_output_upgrade_copy_merge_and_future_rejection(client,image_factory,tmp_path,monkeypatch):
    original=image_factory('output-migration.png');project=payload(original);save_project(client,project,original);v,data=output(project,'jpg');assert save(client,v,data).status_code==201
    old=migrations.backup_database(DATA/'library.db',tmp_path/'old.db')
    with sqlite3.connect(old) as db:db.execute('DROP TABLE collage_outputs');db.execute('PRAGMA user_version=22')
    before=old.read_bytes();backup=migrations.backup_database
    def fail(*a,**k):raise OSError('Synthetic output backup failure')
    monkeypatch.setattr(migrations,'backup_database',fail)
    with pytest.raises(OSError):migrations.migrate_database(old)
    assert old.read_bytes()==before
    monkeypatch.setattr(migrations,'backup_database',backup);migrations.migrate_database(old)
    with sqlite3.connect(old) as db:assert db.execute('PRAGMA user_version').fetchone()[0]==migrations.SCHEMA_VERSION
    moved=tmp_path/'moved';migrate(DATA,moved)
    with sqlite3.connect(moved/'library.db') as db:
        record,assets,path=db.execute('SELECT record,assets,file_path FROM collage_outputs').fetchone();assert Path(path).is_relative_to(moved);assert Path(path).read_bytes()==data
        assert all(Path(a['path']).is_relative_to(moved) for a in json.loads(assets).values())
    incoming=backup(DATA/'library.db',tmp_path/'incoming.db');target=backup(DATA/'library.db',tmp_path/'target.db');stage=tmp_path/'merged.db';merge_libraries(target,incoming,stage,tmp_path/'oldroot',tmp_path/'newroot')
    with sqlite3.connect(stage) as db:
        rows=db.execute('SELECT id,record,assets,file_path FROM collage_outputs').fetchall();assert len(rows)==2 and len({r[0] for r in rows})==2
        projects={r[0] for r in db.execute('SELECT id FROM collage_projects')}
        for id,record,assets,path in rows:record=json.loads(record);schema.stored(id,record,json.loads(assets),path);assert record['project']['id'] in projects
    with sqlite3.connect(incoming) as db:db.execute('PRAGMA user_version=22')
    before=incoming.read_bytes()
    with pytest.raises(ValueError):migrations.migrate_database(incoming)
    assert incoming.read_bytes()==before
