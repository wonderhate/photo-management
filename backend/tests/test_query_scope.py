import json
from sqlalchemy import select
from backend.app.models import Session,Photo,FacePerson,DetectedFace
from backend.app.services import library_service
from test_facets import seed,CONTRACT
from test_metadata import digest

def scope(client,base,mode='capture',**kw):return dict(version=1,library_id=client.get('/api/workspace').json()['library_id'],mode=mode,base=base,**kw)
def ids(client,scope,**filters):
    r=client.get('/api/photos/ids',params={'scope':json.dumps(scope),**filters});assert r.status_code==200,r.text;return r.json()['ids']

def test_collection_scope_survives_refinement_counts_rules_and_manual_order(client,image_factory):
    source=image_factory('scope-collection.jpg');before=digest(source);seed(source)
    album=client.post('/api/albums',json={'name':'Scope collection','photo_ids':['c','a','b']}).json();client.put('/api/albums/'+album['id']+'/order',json={'photo_ids':['c','a','b']})
    fixed=scope(client,{'album_id':album['id']})
    assert ids(client,fixed,sort='manual')==['c','a','b']
    assert ids(client,fixed,camera_model='Canon')==['b']
    assert client.get('/api/filter-options',params={'scope':json.dumps(scope(client,{'album_id':album['id'],'camera_model':'Canon'}))}).json()['camera_model']==['Canon']
    assert set(ids(client,fixed))=={'a','b','c'}
    facets={'version':1,'items':[{'field':'camera_model','op':'in','values':['SONY']} ]}
    r=client.get('/api/facets/camera_model',params={'scope':json.dumps(fixed),'facets':json.dumps(facets)}).json();assert r['total']==3 and r['missing']==0 and r['values']==[{'value':'Canon','count':1},{'value':'SONY','count':2}]
    assert client.get('/api/stats',params={'scope':json.dumps(fixed),'camera_model':'Canon'}).json()['summary']['total']==1
    rule=client.post('/api/albums',json={'name':'Fixed high ratings','type':'rule','query':{'version':1,'root':{'op':'gte','field':'rating','value':4}}}).json();fixed_rule=scope(client,{'album_id':rule['id']})
    assert set(ids(client,fixed_rule))=={'c','e'} and ids(client,fixed_rule,rating='0')==[]
    favorite=scope(client,{'favorite':'true'});assert ids(client,favorite,favorite='false')==[]
    assert client.get('/api/photos',params={'scope':json.dumps(fixed),'page_size':1,'page':2,'sort':'manual'}).json()['photos'][0]['id']=='a'
    client.delete('/api/albums/'+album['id']);assert client.get('/api/photos/ids',params={'scope':json.dumps(fixed)}).status_code==400
    assert digest(source)==before

def test_scope_locks_capture_or_file_mode_and_people_without_loading_models(client,image_factory):
    source=image_factory('scope-pair.jpg');before=digest(source);seed(source)
    with Session() as s:
        p=s.get(Photo,'a');s.add(Photo(id='a-raw',file_name='Facet-a.RAW',file_path=str(source.parent/'Facet-a.RAW'),file_stem='a',source_directory=str(source.parent),file_hash='f'*64,file_format='RAW',file_size=0,is_raw=True,capture_group_id=p.capture_group_id,camera_model='SONY',date_taken=p.date_taken));s.add(FacePerson(id='scope-person',name='Scope person'));s.flush();s.add(DetectedFace(photo_id='a-raw',person_id='scope-person',face_index=0,encoding=b'fixture-only',location={},confirmed=True));s.commit()
    base={'person_id':'scope-person'};capture=scope(client,base,'capture');files=scope(client,base,'file')
    assert ids(client,capture)==['a'] and set(ids(client,files))=={'a','a-raw'}
    assert ids(client,capture,count_mode='file')==['a']
    assert client.get('/api/stats',params={'scope':json.dumps(files),'count_mode':'capture'}).json()['summary']['total']==2
    assert client.get('/api/facets/camera_model',params={'scope':json.dumps(files),'count_mode':'capture'}).json()['total']==2
    assert set(client.get('/api/photos/ids?count_mode=file').json()['ids'])=={p['id'] for p in CONTRACT['rows']}|{'a-raw'}
    assert digest(source)==before

def test_scope_and_legacy_date_bounds_include_the_whole_last_second_and_never_broaden_bad_scopes(client,image_factory):
    source=image_factory('scope-date.jpg');before=digest(source);seed(source)
    params={'date_from':'2026-01-01','date_to':'2026-01-01'}
    assert set(client.get('/api/photos/ids',params=params).json()['ids'])=={'a','b','e'}
    assert set(ids(client,scope(client,params)))=={'a','b','e'}
    assert client.get('/api/stats',params=params).json()['summary']['total']==3
    valid=scope(client,{})
    for bad in ['',{'version':2},{**valid,'library_id':'another-library'},{**valid,'base':{'album_id':'missing-album'}},{**valid,'base':{'scope':'{}'}},{**valid,'base':{'file_path':'/private'}},{**valid,'base':{'date_to':'2026-02-30'}}]:
        r=client.get('/api/photos/ids',params={'scope':json.dumps(bad) if not isinstance(bad,str) else bad});assert r.status_code==400,r.text
    with Session() as s:assert len(list(s.scalars(select(Photo.id))))==5
    assert digest(source)==before
