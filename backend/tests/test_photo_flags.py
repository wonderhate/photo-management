from backend.app.migrations import SCHEMA_VERSION
import json
import sqlite3
from contextlib import closing
from pathlib import Path
import pytest
from sqlalchemy import select
from backend.app.models import Session,Photo
from backend.app.config import DATA
from backend.app.migrations import backup_database,migrate_database
from test_photo_query import seed
from test_metadata import digest

def test_flag_updates_leave_stars_color_favorite_tags_and_originals_independent(client,image_factory):
    source=image_factory('flags-original.jpg');before=digest(source);seed(source)
    client.patch('/api/photos/a',json={'rating':0,'color_label':'blue','favorite':True,'tags':['manual']})
    for flag in ('picked','rejected','unmarked',None):
        response=client.patch('/api/photos/a',json={'flag':flag});assert response.status_code==200,response.text
        p=response.json();assert p['flag']==(flag or 'unmarked')
        assert (p['rating'],p['rating_source'],p['color_label'],p['favorite'],p['tags'])==(0,'manual','blue',True,['manual'])
    for bad in ('other',False,1,[],{}):assert client.patch('/api/photos/a',json={'flag':bad}).status_code==422
    assert client.get('/api/photos/a').json()['flag']=='unmarked' and digest(source)==before

def test_flag_filters_queries_counts_and_batch_changes_use_the_same_scope(client,image_factory):
    source=image_factory('flags-filter.jpg');before=digest(source);seed(source)
    assert set(p['id'] for p in client.get('/api/photos?flag=picked&sort=file_name').json()['photos'])=={'a','e'}
    assert client.get('/api/stats?flag=rejected').json()['summary']['total']==2
    assert set(client.get('/api/photos/ids?flag=unmarked').json()['ids'])=={'c','d'}
    assert client.get('/api/photos?flag=unsafe').status_code==400
    query={'version':1,'root':{'op':'eq','field':'flag','value':'rejected'}}
    a=client.post('/api/albums',json={'name':'Rejected','type':'rule','query':query}).json();assert a['count']==2
    result=client.post('/api/photos/batch-edit',json={'photo_ids':['a','c'],'flag':'rejected'});assert result.status_code==200 and result.json()['updated']==2
    assert client.get('/api/albums/'+a['id']).json()['count']==4
    client.post('/api/photos/batch-edit',json={'photo_ids':['a','b','c','f'],'flag':None})
    assert client.get('/api/albums/'+a['id']).json()['count']==0
    assert set(client.get('/api/photos/ids?flag=unmarked').json()['ids'])=={'a','b','c','d','f'}
    assert client.get('/api/photos').json()['total']==6 and digest(source)==before

def test_flag_migration_backs_up_neutral_legacy_state_and_refuses_failure(client,tmp_path,monkeypatch):
    from backend.app import migrations
    seed();path=backup_database(DATA/'library.db',tmp_path/'flags-v7.db')
    with closing(sqlite3.connect(path)) as db:db.execute('DROP INDEX ix_photos_flag');db.execute('ALTER TABLE photos DROP COLUMN flag');db.execute('PRAGMA user_version=7');db.commit()
    before=path.read_bytes()
    with monkeypatch.context() as patch:
        def fail(*args,**kwargs):raise OSError('Synthetic flag backup failure')
        patch.setattr(migrations,'backup_database',fail)
        with pytest.raises(OSError):migrate_database(path)
    assert path.read_bytes()==before
    assert migrate_database(path)==['photos.flag'];assert migrate_database(path)==[]
    with closing(sqlite3.connect(path)) as db:
        assert db.execute('SELECT DISTINCT flag FROM photos').fetchall()==[('unmarked',)]
        assert db.execute('PRAGMA user_version').fetchone()[0]==SCHEMA_VERSION
    backups=list((tmp_path/'backups').glob('*.db'));assert len(backups)==1
    with closing(sqlite3.connect(backups[0])) as db:assert 'flag' not in [r[1] for r in db.execute('PRAGMA table_info(photos)')]
