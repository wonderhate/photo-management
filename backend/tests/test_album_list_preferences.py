import hashlib
import json
import sqlite3
from sqlalchemy import select
from backend.app.models import Session,Album,AlbumPhoto,initialize,LibraryProfile
from backend.app.config import DATA
from backend.app.migrations import SCHEMA_VERSION
from test_library import import_paths

def test_album_preferences_merge_without_changing_gallery_tools_or_schema(client):
    state=client.get('/api/workspace').json();identity=state['library_id'];assert state['album_preferences']=={}
    def patch(values):return client.patch('/api/workspace/albums',json={'library_id':identity,'values':values})
    assert patch({'sort':'name','direction':'asc'}).json()=={'sort':'name','direction':'asc'}
    assert patch({'order':['a','b']}).json()=={'sort':'name','direction':'asc','order':['a','b']}
    client.patch('/api/workspace/preferences',json={'library_id':identity,'values':{'sort':'rating','direction':'desc'}})
    client.patch('/api/workspace/tools/viewer',json={'library_id':identity,'values':{'pinned':True}})
    initialize();state=client.get('/api/workspace').json();assert state['album_preferences']=={'sort':'name','direction':'asc','order':['a','b']}
    assert state['preferences']=={'sort':'rating','direction':'desc'} and state['tool_preferences']=={'viewer':{'pinned':True}}
    with Session() as session:assert session.get(LibraryProfile,1).preferences['albums']==state['album_preferences']
    with sqlite3.connect(DATA/'library.db') as db:assert db.execute('PRAGMA user_version').fetchone()[0]==SCHEMA_VERSION==28

def test_album_preferences_reject_bad_scope_and_invalid_presentation_data(client):
    identity=client.get('/api/workspace').json()['library_id']
    def patch(values,library=identity):return client.patch('/api/workspace/albums',json={'library_id':library,'values':values})
    assert patch({'sort':'name'},'wrong-library').status_code==409
    for value in [{'sort':'rating'},{'direction':'descending'},{'sort':None},{'direction':True},{'order':None},{'order':['a','a']},{'order':['../private']},{'order':[1]},{'order':True},{'order':['a'*81]},{'order':['']},{'order':[str(i) for i in range(10001)]},{'api_key':'synthetic'}]:assert patch(value).status_code==422
    assert client.get('/api/workspace').json()['album_preferences']=={}

def test_renaming_manual_semantic_and_rule_albums_keeps_members_covers_and_originals(client,image_factory):
    original=image_factory('album-original.jpg');before=hashlib.sha256(original.read_bytes()).hexdigest();import_paths(client,[original]);photo=client.get('/api/photos').json()['photos'][0]
    rule={'version':1,'root':{'op':'is_null','field':'rating'}}
    albums=[]
    for payload in [{'name':'Manual','photo_ids':[photo['id']]},{'name':'Semantic','type':'smart','keywords':['sea'],'photo_ids':[photo['id']],'scores':{photo['id']:.8}},{'name':'Rules','type':'rule','query':rule}]:
        a=client.post('/api/albums',json=payload).json();client.patch('/api/albums/'+a['id'],json={'cover_photo_id':photo['id']});albums.append(client.get('/api/albums/'+a['id']).json())
    with Session() as session:members=[(m.album_id,m.photo_id,m.position,m.similarity_score) for m in session.scalars(select(AlbumPhoto).order_by(AlbumPhoto.album_id))]
    for a in albums:
        result=client.patch('/api/albums/'+a['id'],json={'name':'Renamed '+a['name']});assert result.status_code==200
        after=result.json();assert after['name']=='Renamed '+a['name']
        for key in ('type','query','keywords','person_id','cover_id','count','created_at','ai_model','threshold','match_mode'):assert after[key]==a[key]
        for bad in ['', '   ', 'a'*121]:assert client.patch('/api/albums/'+a['id'],json={'name':bad}).status_code==422
        assert client.get('/api/albums/'+a['id']).json()['name']==after['name']
    with Session() as session:assert [(m.album_id,m.photo_id,m.position,m.similarity_score) for m in session.scalars(select(AlbumPhoto).order_by(AlbumPhoto.album_id))]==members
    assert hashlib.sha256(original.read_bytes()).hexdigest()==before
