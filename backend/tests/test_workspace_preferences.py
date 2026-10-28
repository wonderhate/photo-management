import hashlib
import sqlite3
import json
from backend.app.config import DATA
from backend.app.models import initialize, Session, DocumentViewPreference
from backend.app.migrations import backup_database, migrate_database, SCHEMA_VERSION
from backend.migrate_storage import migrate
from backend.library_maintenance import merge_libraries
from test_editor import create_edit


def test_library_identity_preferences_and_document_views_survive_copy_and_merge(client,image_factory,tmp_path):
    original=image_factory();before=hashlib.sha256(original.read_bytes()).hexdigest()
    state=client.get('/api/workspace').json();identity=state['library_id']
    def gallery(values,library_id=identity):
        return client.patch('/api/workspace/preferences',json=dict(library_id=library_id,values=values))
    assert gallery({'layout':'waterfall','grid':310}).status_code==200
    assert gallery({'radius':0}).json()=={'layout':'waterfall','grid':310,'radius':0}
    assert gallery({'grid':180},'other-library').status_code==409
    tools={'viewer':{'quality':6144,'pinned':True},'compare':{'linked':False},'darkroom':{'format':'png','edge':500,'quality':87},'split':{'width':2.35,'height':1},'lut':{'columns':3,'filter':'favorite','hideLog':True,'strength':.37,'mark:'+'a'*64:'normal'}}
    for tool,values in tools.items():
        assert client.patch('/api/workspace/tools/'+tool,json=dict(library_id=identity,values=values)).json()==values
    assert gallery({'gap':8}).json()=={'layout':'waterfall','grid':310,'radius':0,'gap':8}
    assert client.get('/api/workspace').json()['tool_preferences']==tools
    edit=create_edit(client,original);other=create_edit(client,original)
    document='/api/workspace/documents/'+edit['id']+'/view'
    assert client.get(document).json()=={}
    assert client.patch(document,json=dict(library_id=identity,values={'zoom':2})).json()=={'zoom':2}
    assert client.get('/api/workspace/documents/'+other['id']+'/view').json()=={}
    initialize()
    assert client.get('/api/workspace').json()['library_id']==identity
    assert client.get(document).json()=={'zoom':2}
    assert client.get('/api/workspace').json()['tool_preferences']==tools
    album_prefs={'sort':'count','direction':'desc','order':[]}
    assert client.patch('/api/workspace/albums',json={'library_id':identity,'values':album_prefs}).status_code==200
    facet_prefs={'hidden':['tag','orientation']}
    assert client.patch('/api/workspace/facets',json={'library_id':identity,'values':facet_prefs}).status_code==200
    moved=tmp_path/'moved';migrate(DATA,moved)
    with sqlite3.connect(moved/'library.db') as db:
        assert db.execute('SELECT library_id FROM library_profile').fetchone()[0]==identity
        assert json.loads(db.execute('SELECT preferences FROM document_view_preferences').fetchone()[0])=={'zoom':2}
        assert json.loads(db.execute('SELECT preferences FROM library_profile').fetchone()[0])['tools']==tools
        assert json.loads(db.execute('SELECT preferences FROM library_profile').fetchone()[0])['albums']==album_prefs
        assert json.loads(db.execute('SELECT preferences FROM library_profile').fetchone()[0])['facets']==facet_prefs
    target=backup_database(DATA/'library.db',tmp_path/'target.db')
    incoming=backup_database(DATA/'library.db',tmp_path/'incoming.db')
    with sqlite3.connect(incoming) as db:
        db.execute("UPDATE library_profile SET library_id='incoming-library',preferences=?",(json.dumps({'tools':{'viewer':{'quality':4096}}}),))
    stage=tmp_path/'merged.db';merge_libraries(target,incoming,stage,tmp_path/'old',tmp_path/'new')
    with sqlite3.connect(stage) as db:
        assert db.execute('SELECT library_id FROM library_profile').fetchone()[0]==identity
        assert len(db.execute('SELECT * FROM document_view_preferences').fetchall())==2
        assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
        assert json.loads(db.execute('SELECT preferences FROM library_profile').fetchone()[0])['tools']==tools
        assert json.loads(db.execute('SELECT preferences FROM library_profile').fetchone()[0])['albums']==album_prefs
        assert json.loads(db.execute('SELECT preferences FROM library_profile').fetchone()[0])['facets']==facet_prefs
    assert client.delete('/api/editor/edits/'+edit['id']).status_code==200
    with Session() as session: assert session.get(DocumentViewPreference,edit['id']) is None
    assert hashlib.sha256(original.read_bytes()).hexdigest()==before


def test_tool_preferences_merge_validate_and_leave_document_content_unchanged(client,image_factory):
    original=image_factory();before=hashlib.sha256(original.read_bytes()).hexdigest()
    identity=client.get('/api/workspace').json()['library_id'];edit=create_edit(client,original)
    def patch(tool,values,library_id=identity):
        return client.patch('/api/workspace/tools/'+tool,json=dict(library_id=library_id,values=values))
    assert patch('viewer',{'pinned':True}).json()=={'pinned':True}
    assert patch('viewer',{'quality':4096}).json()=={'pinned':True,'quality':4096}
    assert patch('darkroom',{'format':'png','edge':0,'quality':100}).status_code==200
    assert patch('compare',{'linked':False}).status_code==200
    assert patch('viewer',{'quality':6144},'another-library').status_code==409
    for tool,values in [('viewer',{'quality':True}),('viewer',{'quality':4096.0}),('viewer',{'quality':2048}),('viewer',{'pinned':1}),('viewer',{'quality':None}),('viewer',{'playing':True}),('viewer',{'key':'secret'}),('compare',{'linked':'false'}),('compare',{'zoom':2}),('darkroom',{'format':'avif'}),('darkroom',{'edge':-1}),('darkroom',{'edge':16001}),('darkroom',{'quality':0}),('darkroom',{'quality':101}),('darkroom',{'recipe':{}}),('unknown',{})]:
        assert patch(tool,values).status_code==422
    state=client.get('/api/workspace').json()
    assert state['preferences']=={}
    assert state['tool_preferences']=={'viewer':{'pinned':True,'quality':4096},'darkroom':{'format':'png','edge':0,'quality':100},'compare':{'linked':False}}
    assert client.get('/api/editor/edits/'+edit['id']).json()==edit
    assert hashlib.sha256(original.read_bytes()).hexdigest()==before


def test_preferences_reject_cross_scope_fields_nulls_and_unbounded_values(client,image_factory):
    identity=client.get('/api/workspace').json()['library_id']
    for values in [{'theme':'dark'},{'recipe':{}},{'grid':149},{'grid':True},{'gap':37},
                   {'radius':None},{'dense':1},{'sort':'manual'},{'direction':'ascending'}]:
        assert client.patch('/api/workspace/preferences',json=dict(library_id=identity,values=values)).status_code==422
    edit=create_edit(client,image_factory());path='/api/workspace/documents/'+edit['id']+'/view'
    for values in [{'zoom':3},{'zoom':True},{'zoom':1,'recipe':{}},{'zoom':None}]:
        assert client.patch(path,json=dict(library_id=identity,values=values)).status_code==422
    assert client.get('/api/workspace').json()['preferences']=={}
    assert client.patch(path,json=dict(library_id='different',values={'zoom':1.5})).status_code==409
    assert client.patch('/api/workspace/documents/missing/view',json=dict(library_id=identity,values={'zoom':1})).status_code==404


def test_split_preferences_allow_fractional_sides_and_reject_invalid_or_cross_scope_fields(client):
    identity=client.get('/api/workspace').json()['library_id']
    def patch(values,library_id=identity):
        return client.patch('/api/workspace/tools/split',json=dict(library_id=library_id,values=values))
    assert patch({'width':2.35,'height':1}).json()=={'width':2.35,'height':1}
    for value in [{'width':0},{'height':101},{'width':True},{'height':'4'},{'count':3},{'region':{}},{'width':None}]:
        assert patch(value).status_code==422
    assert patch({'width':3},'another-library').status_code==409
    assert client.get('/api/workspace').json()['tool_preferences']=={'split':{'width':2.35,'height':1}}


def test_v2_upgrade_backs_up_and_assigns_identity_once(tmp_path):
    path=tmp_path/'library.db'
    with sqlite3.connect(path) as db:
        db.execute('CREATE TABLE photos(id VARCHAR PRIMARY KEY)')
        db.execute('PRAGMA user_version=2')
    changes=migrate_database(path)
    assert 'library_profile' in changes and 'document_view_preferences' in changes
    backups=list((tmp_path/'backups').glob('*.db'));assert len(backups)==1
    with sqlite3.connect(backups[0]) as db: assert db.execute('PRAGMA user_version').fetchone()[0]==2
    with sqlite3.connect(path) as db:
        identity=db.execute('SELECT library_id FROM library_profile').fetchone()[0]
        assert db.execute('PRAGMA user_version').fetchone()[0]==SCHEMA_VERSION
    assert migrate_database(path)==[]
    with sqlite3.connect(path) as db: assert db.execute('SELECT library_id FROM library_profile').fetchone()[0]==identity


def test_lut_view_marks_merge_without_changing_edits_or_originals(client,image_factory):
    original=image_factory();before=hashlib.sha256(original.read_bytes()).hexdigest();edit=create_edit(client,original)
    identity=client.get('/api/workspace').json()['library_id']
    def patch(values,library_id=identity):return client.patch('/api/workspace/tools/lut',json=dict(library_id=library_id,values=values))
    a,b='mark:'+'a'*64,'mark:'+'b'*64
    assert patch({'columns':3,'filter':'recent','hideLog':True,'strength':.37,a:'log'}).status_code==200
    assert patch({b:'normal'}).json()[a]=='log'
    assert patch({a:'auto'}).json()[b]=='normal'
    saved=client.get('/api/workspace').json()['tool_preferences']['lut']
    for value in [{'columns':True},{'columns':2.0},{'columns':4},{'hideLog':1},{'strength':True},{'strength':1.1},{'filter':'log'},{'path':'private'},{'recipe':{}},{'mark:bad':'log'},{a:1},{a:'camera'},{'hideLog':None}]:assert patch(value).status_code==422
    assert patch({'strength':0},'other-library').status_code==409
    assert client.get('/api/workspace').json()['tool_preferences']['lut']==saved
    assert client.get('/api/editor/edits/'+edit['id']).json()['recipe']==edit['recipe']
    assert hashlib.sha256(original.read_bytes()).hexdigest()==before
