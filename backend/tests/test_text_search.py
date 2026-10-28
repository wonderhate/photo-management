from backend.app.migrations import SCHEMA_VERSION
import hashlib
import json
import sqlite3
from contextlib import closing
from pathlib import Path
import pytest
from sqlalchemy import select,insert
from backend.app.models import Session,Photo,CaptureGroup,engine
from backend.app.services import text_index,library_service,photo_query,jobs
from test_metadata import digest
from test_library import wait_job

CONTRACT=json.loads((Path(__file__).resolve().parents[2]/'frontend/tests/fixtures/text-search-contract.json').read_text('utf-8'))

def seed(source=None):
    with Session() as s:
        for row in CONTRACT['rows']:s.add(CaptureGroup(id=row['id'],preferred_photo_id=row['id']))
        s.flush()
        for row in CONTRACT['rows']:
            p=dict(row);names=p.pop('tags');path=source if source and p['id']=='a' else Path('/synthetic-text')/p['file_name']
            photo=Photo(**p,file_path=str(path),file_stem=p['file_name'],source_directory=str(path.parent),file_hash=hashlib.sha256(p['id'].encode()).hexdigest(),file_size=0,file_format='JPG',capture_group_id=p['id']);s.add(photo);s.flush();library_service.set_tags(s,photo,names)
        s.commit()

def matching(root):
    with Session() as s:return list(s.scalars(library_service.query_photos({'query':{'version':1,'root':root}}).with_only_columns(Photo.id).order_by(Photo.id)))

def drain():
    while text_index.batch(engine)[0]:pass

def test_shared_text_contract_is_correct_before_and_after_fts_and_metadata_changes(client,image_factory):
    source=image_factory('text-original.jpg');before=digest(source);seed(source)
    assert text_index.status()['available'] is True
    for indexed in (False,True):
        if indexed:drain();assert text_index.status()['indexed']==4
        for case in CONTRACT['cases']:assert matching(case['root'])==case['ids'],(indexed,case['name'])
    assert text_index.candidate('text','icontains','SUNRISE') is not None
    assert text_index.candidate('text','icontains','海边') is None
    assert text_index.candidate('text','icontains','café') is None
    client.patch('/api/photos/a',json={'user_description':'人工替代','remove_tags':['山']})
    assert matching({'op':'icontains','field':'text','value':'sunrise'})==[]
    assert matching({'op':'icontains','field':'text','value':'人工替代'})==['a']
    drain();assert matching({'op':'icontains','field':'text','value':'人工替代'})==['a']
    client.delete('/api/photos/a?scope=file');assert matching({'op':'icontains','field':'text','value':'人工替代'})==[];drain()
    assert text_index.status()['indexed']==3 and digest(source)==before
    assert client.post('/api/removals/photos/restore',json={'ids':['a']}).status_code==200
    assert matching({'op':'icontains','field':'text','value':'人工替代'})==['a']
    drain();assert text_index.status()['indexed']==4 and digest(source)==before

def test_cache_rebuild_is_a_local_metadata_job_and_a_missing_index_falls_back(client,image_factory):
    source=image_factory('index-original.jpg');before=digest(source);seed(source)
    job=client.post('/api/search/index/rebuild').json();assert job['kind']=='text-index' and job['resource']=='io' and job['billable'] is False
    finished=wait_job(client,job);assert finished['success']==4
    assert matching({'op':'icontains','field':'text','value':'sunrise'})==['a']
    with engine.begin() as c:c.exec_driver_sql("DELETE FROM pc_photo_text WHERE photo_id='a'")
    assert matching({'op':'icontains','field':'text','value':'sunrise'})==['a']
    assert text_index.status()['available'] is False
    finished=wait_job(client,client.post('/api/search/index/rebuild').json());assert finished['success']==4
    assert text_index.status()['available'] and text_index.status()['pending']==0 and digest(source)==before

def test_text_filters_keep_scope_counts_and_semantic_synonyms_separate(client,image_factory,monkeypatch):
    source=image_factory('text-scope.jpg');before=digest(source);seed(source)
    from backend.app.services.embedding_service import service
    calls=[]
    def synonyms(words,mode,threshold,limit):
        calls.append((words,mode,threshold,limit));return [{'photo_id':'a','score':.9}] if words[0] in ('海滨','海岸') else []
    monkeypatch.setattr(service,'search',synonyms)
    for term in ('海滨','海岸'):
        with Session() as s:
            rows=list(s.scalars(library_service.query_photos({'semantic':term}).with_only_columns(Photo.id)))
            assert rows==['a']
    assert [c[0] for c in calls]==[['海滨'],['海岸']]
    album=client.post('/api/albums',json={'name':'Text scope','photo_ids':['b','c']}).json()
    for path in ('/api/photos','/api/photos/ids','/api/stats'):
        r=client.get(path,params={'text':'海边','album_id':album['id']});assert r.status_code==200
        body=r.json();assert body.get('total',body.get('summary',{}).get('total',len(body.get('ids',[]))))==0
    rule=client.post('/api/albums',json={'name':'OCR','type':'rule','query':{'version':1,'root':{'op':'icontains','field':'detected_text','value':'open'}}}).json()
    assert rule['count']==1
    # The new API invokes automatic local maintenance; wait before fixture teardown.
    state=text_index.status()
    if state['job_id']:wait_job(client,jobs.get(state['job_id']))
    assert digest(source)==before

def test_search_sees_its_own_uncommitted_edit_and_rollback_preserves_cached_truth(client,image_factory):
    source=image_factory('text-transaction.jpg');before=digest(source);seed(source);drain()
    with Session() as s:
        p=s.get(Photo,'a');p.user_description='事务中人工描述';s.flush()
        statement=library_service.query_photos({'query':{'version':1,'root':{'op':'icontains','field':'text','value':'事务中人工描述'}}}).with_only_columns(Photo.id)
        assert list(s.scalars(statement))==['a']
        s.rollback()
    assert matching({'op':'icontains','field':'text','value':'事务中人工描述'})==[]
    assert matching({'op':'icontains','field':'text','value':'sunrise'})==['a'] and digest(source)==before

def test_ten_thousand_metadata_rows_use_bounded_batches_and_a_real_fts_query_plan(client):
    for start in range(0,10000,500):
        ids=['TextLarge-'+str(i).zfill(5) for i in range(start,min(start+500,10000))]
        with Session() as s:
            s.execute(insert(CaptureGroup),[{'id':v,'preferred_photo_id':v} for v in ids])
            s.execute(insert(Photo),[dict(id=v,file_name=v+'.jpg',file_path='/synthetic-text-large/'+v+'.jpg',file_stem=v,source_directory='/synthetic-text-large',file_hash=hashlib.sha256(v.encode()).hexdigest(),file_format='JPG',file_size=0,capture_group_id=v,user_description='UniqueFinalWord' if v.endswith('09999') else '文字索引样例') for v in ids]);s.commit()
    counts=[]
    while True:
        n,_=text_index.batch(engine)
        if not n:break
        counts.append(n)
    assert sum(counts)==10000 and max(counts)<=256 and text_index.status()['indexed']==10000
    assert matching({'op':'icontains','field':'text','value':'uniquefinalword'})==['TextLarge-09999']
    with engine.connect() as c:
        plan=c.exec_driver_sql('EXPLAIN QUERY PLAN SELECT photo_id FROM pc_photo_text WHERE body MATCH ?',('"uniquefinalword"',)).fetchall()
    assert any('VIRTUAL TABLE INDEX' in row[3] for row in plan)


def test_missing_trigram_support_preserves_search_and_raw_metadata_writes(client,image_factory,monkeypatch):
    from sqlalchemy.engine import Connection
    source=image_factory('text-no-fts.jpg');before=digest(source);seed(source)
    original=Connection.exec_driver_sql
    def unavailable(connection,statement,*args,**kwargs):
        if statement.startswith('CREATE VIRTUAL TABLE temp.pc_text_probe'):raise sqlite3.OperationalError('no such tokenizer: trigram')
        return original(connection,statement,*args,**kwargs)
    with monkeypatch.context() as patch:
        patch.setattr(Connection,'exec_driver_sql',unavailable);text_index.initialize(engine,True)
    assert not text_index.status()['available']
    assert matching({'op':'icontains','field':'text','value':'sunrise'})==['a']
    # Maintenance connections need neither the FTS module nor registered UDFs.
    with closing(sqlite3.connect(engine.url.database)) as c:c.execute("UPDATE photos SET user_description='Maintenance Changed' WHERE id='a'");c.commit()
    assert matching({'op':'icontains','field':'text','value':'maintenance changed'})==['a']
    assert matching({'op':'icontains','field':'text','value':'sunrise'})==[]
    text_index.initialize(engine,True);drain();assert text_index.status()['available'] and digest(source)==before


def test_schema9_upgrade_backs_up_metadata_before_new_rule_semantics(client,image_factory,tmp_path,monkeypatch):
    from backend.app import migrations
    source=image_factory('text-version.jpg');before=digest(source);seed(source)
    path=tmp_path/'text-v9.db';migrations.backup_database(Path(engine.url.database),path)
    with closing(sqlite3.connect(path)) as c:c.execute('PRAGMA user_version=9');c.commit()
    with monkeypatch.context() as patch:
        def fail(*args,**kwargs):raise OSError('Synthetic backup failure')
        patch.setattr(migrations,'backup_database',fail)
        with pytest.raises(OSError):migrations.migrate_database(path)
    with closing(sqlite3.connect(path)) as c:assert c.execute('PRAGMA user_version').fetchone()[0]==9
    migrations.migrate_database(path);backups=list((tmp_path/'backups').glob('*.db'));assert len(backups)==1
    for target,version in [(backups[0],9),(path,SCHEMA_VERSION)]:
        with closing(sqlite3.connect(target)) as c:
            assert c.execute('PRAGMA user_version').fetchone()[0]==version
            assert c.execute("SELECT user_description FROM photos WHERE id='b'").fetchone()[0]==''
            assert json.loads(c.execute("SELECT annotation FROM photos WHERE id='a'").fetchone()[0])['caption']=='海边日出 sunrise'
    migrations.migrate_database(path);assert len(list((tmp_path/'backups').glob('*.db')))==1 and digest(source)==before
