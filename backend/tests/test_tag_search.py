import hashlib
import json
from sqlalchemy import select
from backend.app.models import Session,Photo,PhotoTag,Tag,CaptureGroup
from test_facets import seed
from test_metadata import digest
from test_query_scope import scope

def test_scoped_tag_pages_origins_literal_matching_and_live_edits(client,image_factory):
    source=image_factory('tag-pages.jpg');before=digest(source);seed(source)
    with Session() as s:
        travel=s.scalar(select(Tag).where(Tag.name=='旅行'));s.get(PhotoTag,('b',travel.id)).origin='ai';s.commit()
    fixed=scope(client,{'album_id':client.post('/api/albums',json={'name':'Tag scope','photo_ids':['a','b','d']}).json()['id']})
    def tags(**params):
        r=client.get('/api/tags',params={'scope':json.dumps(fixed),**params});assert r.status_code==200,r.text;return r.json()
    assert tags(q='旅行')['values']==[dict(value='旅行',count=2,user_count=1)]
    assert tags(q='旅行')['missing']==1
    assert tags(q='旅行',tag='人像')['values']==[dict(value='旅行',count=1,user_count=1)]
    assert tags(page_size=1)['has_more'] and len(tags(page=2,page_size=1)['values'])==1
    assert 'tags' not in client.get('/api/filter-options?include_tags=false').json()
    client.patch('/api/photos/a',json={'add_tags':['Literal %_','人工 🐱']});assert tags(q='%_')['values']==[dict(value='Literal %_',count=1,user_count=1)]
    assert tags(q='🐱')['values'][0]['value']=='人工 🐱';client.patch('/api/photos/a',json={'remove_tags':['Literal %_']});assert tags(q='%_')['values']==[]
    for params in [{'page':0},{'page_size':101},{'q':'a'*257},{'q':'\0'},{'order':'random'},{'scope':json.dumps({**fixed,'library_id':'other-library'})}]:assert client.get('/api/tags',params=params).status_code==400
    assert digest(source)==before

def test_ten_thousand_tags_return_bounded_stable_pages_without_source_reads(client,image_factory):
    source=image_factory('many-tags.jpg');before=digest(source);seed(source)
    with Session() as s:
        for i in range(100):s.add(CaptureGroup(id='many-tag-'+str(i),preferred_photo_id='many-tag-'+str(i)))
        s.flush()
        for i in range(100):
            key='many-tag-'+str(i);s.add(Photo(id=key,file_name=key+'.jpg',file_path=str(source.parent/(key+'.jpg')),file_stem=key,source_directory=str(source.parent),file_hash=hashlib.sha256(key.encode()).hexdigest(),file_size=0,file_format='JPG',capture_group_id=key))
        s.flush()
        for i in range(10000):
            name='Tag-'+str(i).zfill(5);key=hashlib.sha256(name.encode()).hexdigest();s.add(Tag(id=key,name=name))
        s.flush()
        for i in range(10000):
            name='Tag-'+str(i).zfill(5);s.add(PhotoTag(photo_id='many-tag-'+str(i//100),tag_id=hashlib.sha256(name.encode()).hexdigest(),origin='user' if i%2 else 'ai'))
        s.commit()
    ids=[]
    for page in range(1,101):
        r=client.get('/api/tags',params={'q':'Tag-','page_size':100,'page':page}).json();assert len(r['values'])==100;assert r['has_more']==(page<100);ids.extend(v['value'] for v in r['values'])
    assert len(set(ids))==10000 and ids==sorted(ids)
    r=client.get('/api/tags?q=TAG-09999&page_size=7').json();assert r['values']==[dict(value='Tag-09999',count=1,user_count=1)]
    r=client.get('/api/tags?q=Tag-&page_size=2&order=manual').json();assert [v['value'] for v in r['values']]==['Tag-00001','Tag-00003']
    assert digest(source)==before
