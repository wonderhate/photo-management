from backend.app.migrations import SCHEMA_VERSION
import hashlib
import json
import sqlite3
from contextlib import closing
import pytest
from pathlib import Path
from sqlalchemy import select
from backend.app.models import Session,Photo,CaptureGroup,engine
from backend.app.services import library_service,photo_facets
from test_metadata import digest

CONTRACT=json.loads((Path(__file__).resolve().parents[2]/'frontend/tests/fixtures/facet-contract.json').read_text('utf-8'))

def seed(source):
    with Session() as s:
        for row in CONTRACT['rows']:s.add(CaptureGroup(id=row['id'],preferred_photo_id=row['id']))
        s.flush()
        for row in CONTRACT['rows']:
            data=dict(row);tags=data.pop('tags');path=source if data['id']=='a' else source.parent/data['file_name']
            p=Photo(**data,file_path=str(path),file_stem=data['id'],source_directory=str(path.parent),file_hash=digest(source) if data['id']=='a' else hashlib.sha256(data['id'].encode()).hexdigest(),file_size=0,capture_group_id=data['id']);s.add(p);s.flush();library_service.set_tags(s,p,tags)
        s.commit()

def test_shared_facets_match_sql_and_scoped_counts_ignore_only_the_requested_temporary_field(client,image_factory):
    source=image_factory('facets.jpg');before=digest(source);seed(source)
    for c in CONTRACT['cases']:
        with Session() as s:assert list(s.scalars(library_service.query_photos({'facets':c['state']}).with_only_columns(Photo.id).order_by(Photo.id)))==c['ids'],c['name']
    state=dict(version=1,items=[dict(field='camera_model',op='in',values=['SONY'])])
    def options(field='camera_model',**params):
        r=client.get('/api/facets/'+field,params={'facets':json.dumps(state),**params});assert r.status_code==200,r.text;return r.json()
    assert options()==dict(field='camera_model',total=5,missing=1,values=[dict(value='Canon',count=1),dict(value='SONY',count=3)],page=1,has_more=False)
    assert options(camera='SONY')['total']==5
    assert options(iso_min=400)['values']==[dict(value='Canon',count=1),dict(value='SONY',count=1)]
    album=client.post('/api/albums',json={'name':'Facet scope','photo_ids':['b','c','d']}).json()
    scoped=options(album_id=album['id']);assert scoped['total']==3 and scoped['missing']==1 and [r['count'] for r in scoped['values']]==[1,1]
    fixed={'version':1,'root':{'op':'eq','field':'camera_model','value':'SONY'}}
    assert options(query=json.dumps(fixed))['values']==[dict(value='SONY',count=3)]
    assert options(page_size=1)['has_more'] and options(page_size=1,page=2)['values']==[dict(value='SONY',count=3)]
    assert options(q='canon')['values']==[dict(value='Canon',count=1)]
    assert options('rating')['missing']==0 # Own camera condition stays for another facet.
    for path in ['/api/photos','/api/photos/ids','/api/stats']:
        r=client.get(path,params={'facets':json.dumps(state),'album_id':album['id']});assert r.status_code==200
        body=r.json();assert body.get('total',body.get('summary',{}).get('total',len(body.get('ids',[]))))==1
    assert digest(source)==before

def test_facet_validation_and_preference_identity_preserve_other_namespaces(client,image_factory):
    source=image_factory('facet-preferences.jpg');before=digest(source);seed(source)
    for c in CONTRACT['cases']:assert photo_facets.normalize(c['state'])['version']==1
    for state in [{'version':2,'items':[]},{'version':1,'items':[{'field':'file_path','op':'in','values':['x']}]},{'version':1,'items':[{'field':'rating','op':'in','values':[True]}]},{'version':1,'items':[{'field':'iso','op':'range','min':800,'max':100}]}]:
        assert client.get('/api/photos',params={'facets':json.dumps(state)}).status_code==400
    assert client.get('/api/facets/file_path').status_code==400
    identity=client.get('/api/workspace').json()['library_id'];client.patch('/api/workspace/preferences',json={'library_id':identity,'values':{'grid':170}})
    assert client.patch('/api/workspace/facets',json={'library_id':identity,'values':{'hidden':['camera_make','tag']}}).status_code==200
    assert client.patch('/api/workspace/facets',json={'library_id':'old-library','values':{'hidden':[]}}).status_code==409
    for hidden in [['tag','tag'],['unknown'],None]:assert client.patch('/api/workspace/facets',json={'library_id':identity,'values':{'hidden':hidden}}).status_code==422
    state=client.get('/api/workspace').json();assert state['preferences']['grid']==170 and state['facet_preferences']=={'hidden':['camera_make','tag']} and digest(source)==before


def test_schema10_upgrade_backs_up_before_orientation_rules_and_keeps_originals(client,image_factory,tmp_path,monkeypatch):
    from backend.app import migrations
    source=image_factory('facet-version.jpg');before=digest(source);seed(source)
    path=tmp_path/'facets-v10.db';migrations.backup_database(Path(engine.url.database),path)
    with closing(sqlite3.connect(path)) as c:c.execute('PRAGMA user_version=10');c.commit()
    with monkeypatch.context() as patch:
        def fail(*args,**kwargs):raise OSError('Synthetic facet backup failure')
        patch.setattr(migrations,'backup_database',fail)
        with pytest.raises(OSError):migrations.migrate_database(path)
    with closing(sqlite3.connect(path)) as c:assert c.execute('PRAGMA user_version').fetchone()[0]==10
    migrations.migrate_database(path);backups=list((tmp_path/'backups').glob('*.db'));assert len(backups)==1
    for target,version in [(backups[0],10),(path,SCHEMA_VERSION)]:
        with closing(sqlite3.connect(target)) as c:
            assert c.execute('PRAGMA user_version').fetchone()[0]==version
            assert c.execute('SELECT count(*) FROM photos').fetchone()[0]==5
            assert c.execute("SELECT rating FROM photos WHERE id='a'").fetchone()[0]==0
            assert c.execute("SELECT rating FROM photos WHERE id='b'").fetchone()[0] is None
    migrations.migrate_database(path);assert len(list((tmp_path/'backups').glob('*.db')))==1
    rule=client.post('/api/albums',json={'name':'Landscape rule','type':'rule','query':{'version':1,'root':{'op':'eq','field':'orientation','value':'landscape'}}});assert rule.status_code==200 and rule.json()['count']==2
    assert client.get('/api/albums/'+rule.json()['id']).json()['count']==2 and digest(source)==before
