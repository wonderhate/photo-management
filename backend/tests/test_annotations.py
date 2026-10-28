from backend.app.migrations import SCHEMA_VERSION
import json
import sqlite3
from contextlib import closing
import pytest
from pathlib import Path
from backend.app.config import DATA
from backend.app.migrations import backup_database,migrate_database
from backend.library_maintenance import merge_libraries
from test_library import import_paths
from test_metadata import digest

def imported(client,path):
    import_paths(client,[path])
    return next(p for p in client.get('/api/photos?count_mode=file').json()['photos'] if p['file_name']==path.name)

def annotation(p,**changes):
    return dict(version=1,expected_revision=(p.get('annotation') or {}).get('revision',0),source_hash=p['file_hash'],caption='AI 山间小溪',tags=['Manual','山','溪'],provider='synthetic-local',model='fixture-v1',detected_text='SYNTHETIC')|changes

def result(client,p,**changes):
    response=client.post('/api/photos/'+p['id']+'/annotation',json=annotation(p,**changes))
    assert response.status_code==200,response.text
    return response.json()

def test_shared_annotation_contract_matches_browser(client,image_factory):
    contract=json.loads((Path(__file__).resolve().parents[2]/'frontend/tests/fixtures/annotation-contract.json').read_text('utf-8'))
    source=image_factory('annotation-contract.jpg');before=digest(source);p=imported(client,source);url='/api/photos/'+p['id']
    p=client.patch(url,json=contract['initial']).json()
    for step in contract['steps']:
        p=result(client,p,**step['ai']) if 'ai' in step else client.patch(url,json=step['manual']).json()
        assert p['tag_origins']==step['origins'] and p['rejected_ai_tags']==step['rejected']
        assert p['description']==step['description'] and p['description_source']==step['source']
    assert digest(source)==before

def test_manual_tags_keep_the_existing_browser_200_character_and_item_capacity(client,image_factory):
    source=image_factory('legacy-long-tags.jpg');before=digest(source);p=imported(client,source);url='/api/photos/'+p['id']
    names=['旧'*150]+['tag-'+str(i) for i in range(199)]
    p=client.patch(url,json={'tags':names}).json();assert set(p['tags'])==set(names)
    p=result(client,p,tags=['旧'*100]);assert p['tag_origins'][names[0]]=='user' and set(names)<=set(p['tags'])
    p=client.patch(url,json={'remove_tags':[names[0]]}).json();assert names[0] not in p['tags'] and names[0] in p['rejected_ai_tags']
    p=client.patch(url,json={'add_tags':[names[0]]}).json();assert p['tag_origins'][names[0]]=='user' and names[0] not in p['rejected_ai_tags']
    assert digest(source)==before

def test_relabel_preserves_manual_blank_promoted_tags_and_rejections(client,image_factory):
    source=image_factory('annotation.jpg');before=digest(source);p=imported(client,source);url='/api/photos/'+p['id']
    p=client.patch(url,json={'user_description':'','tags':['旅行','Manual'],'favorite':True,'rating':0,'flag':'picked','color_label':'blue'}).json()
    p=result(client,p)
    assert p['description'] is None and p['description_source']=='user'
    assert p['tag_origins']=={'旅行':'user','Manual':'user','山':'ai','溪':'ai'}
    p=client.patch(url,json={'add_tags':['溪'],'remove_tags':['山']}).json()
    assert p['rejected_ai_tags']==['山'] and p['tag_origins']['溪']=='user'
    p=result(client,p,tags=['Manual','山','云'],caption='New AI caption')
    assert set(p['tags'])=={'旅行','Manual','溪','云'} and p['tag_origins']['云']=='ai'
    assert p['description'] is None and p['description_source']=='user'
    p=client.patch(url,json={'tags':['旅行','Manual','溪']}).json()
    p=result(client,p,tags=['山','云','雨'])
    assert set(p['tags'])=={'旅行','Manual','溪','雨'}
    p=client.patch(url,json={'restore_ai_tags':['山']}).json()
    assert p['tag_origins']['山']=='ai' and '山' not in p['rejected_ai_tags']
    p=result(client,p,tags=['山'])
    assert p['tag_origins']['山']=='ai'
    p=client.patch(url,json={'user_description':'  人工说明  '}).json();p=result(client,p,caption='Later AI')
    assert p['description']=='人工说明'
    p=client.patch(url,json={'user_description':None}).json()
    assert p['description']=='Later AI' and p['description_source']=='ai'
    assert (p['favorite'],p['rating'],p['color_label'],p['flag'])==(True,0,'blue','picked')
    assert digest(source)==before

def test_annotation_revision_validation_and_batch_preserve_latest_decisions(client,image_factory):
    source=image_factory('annotation-cas.jpg');before=digest(source);p=imported(client,source);url='/api/photos/'+p['id'];payload=annotation(p)
    p=result(client,p)
    for stale in (payload,annotation(p,source_hash='0'*64)):
        assert client.post(url+'/annotation',json=stale).status_code==409
        assert client.get(url).json()==p
    for changes in ({'version':True},{'version':2},{'tags':[123]},{'tags':['x']*101},{'caption':'x'*4001},{'expected_revision':True},{'api_key':'do-not-store'},{'provider':'  '},{'detected_text':[]},{'source_hash':'bad'}):
        assert client.post(url+'/annotation',json=annotation(p,**changes)).status_code==422
    response=client.post('/api/photos/batch-edit',json={'photo_ids':[p['id']],'user_description':'','add_tags':['溪'],'remove_tags':['山','未来标签']})
    assert response.status_code==200
    p=client.get(url).json();p=result(client,p,tags=['山','未来标签','溪','新 AI'])
    assert p['description'] is None and p['description_source']=='user'
    assert '山' not in p['tags'] and '未来标签' not in p['tags'] and p['tag_origins']['溪']=='user' and p['tag_origins']['新 AI']=='ai'
    assert digest(source)==before

def test_annotation_migration_pins_old_database_and_handles_backup_failure(client,image_factory,tmp_path,monkeypatch):
    from backend.app import migrations
    p=imported(client,image_factory('legacy-tags.jpg'));client.patch('/api/photos/'+p['id'],json={'tags':['旧标签']})
    path=backup_database(DATA/'library.db',tmp_path/'v8.db')
    with closing(sqlite3.connect(path)) as db:
        for field in ('user_description','annotation','rejected_ai_tags'):db.execute('ALTER TABLE photos DROP COLUMN '+field)
        db.execute('ALTER TABLE photo_tags DROP COLUMN origin');db.execute('PRAGMA user_version=8');db.commit()
    before=path.read_bytes()
    with monkeypatch.context() as patch:
        def fail(*a,**kw):raise OSError('Synthetic annotation backup failure')
        patch.setattr(migrations,'backup_database',fail)
        with pytest.raises(OSError):migrate_database(path)
    assert path.read_bytes()==before
    assert set(migrate_database(path))=={'photos.user_description','photos.annotation','photos.rejected_ai_tags','photo_tags.origin'}
    assert migrate_database(path)==[]
    with closing(sqlite3.connect(path)) as db:
        assert db.execute('SELECT user_description,annotation,rejected_ai_tags FROM photos').fetchone()==(None,None,'[]')
        assert db.execute('SELECT origin FROM photo_tags').fetchone()==('user',)
        assert db.execute('PRAGMA user_version').fetchone()[0]==SCHEMA_VERSION
    backups=list((tmp_path/'backups').glob('*.db'));assert len(backups)==1
    with closing(sqlite3.connect(backups[0])) as db:assert 'annotation' not in [v[1] for v in db.execute('PRAGMA table_info(photos)')]

def test_merge_keeps_destination_blank_and_rejections_and_reads_old_origins(client,image_factory,tmp_path):
    first=image_factory('merge-annotation.jpg');p=imported(client,first);p=result(client,p)
    client.patch('/api/photos/'+p['id'],json={'user_description':'','remove_tags':['山']})
    target=backup_database(DATA/'library.db',tmp_path/'target.db')
    client.patch('/api/photos/'+p['id'],json={'user_description':'Incoming manual','add_tags':['山']})
    second=image_factory('merge-new-note.jpg',color=(30,45,90));q=imported(client,second);client.patch('/api/photos/'+q['id'],json={'tags':['Incoming'],'user_description':'New note'})
    incoming=backup_database(DATA/'library.db',tmp_path/'source.db');before=[digest(v) for v in (first,second)]
    stage=tmp_path/'merged.db';merge_libraries(target,incoming,stage,tmp_path/'old',tmp_path/'new')
    with closing(sqlite3.connect(stage)) as db:
        note,rejected=db.execute('SELECT user_description,rejected_ai_tags FROM photos WHERE id=?',(p['id'],)).fetchone()
        assert note=='' and json.loads(rejected)==['山']
        assert db.execute('SELECT COUNT(*) FROM photo_tags JOIN tags ON tags.id=photo_tags.tag_id WHERE photo_id=? AND name=?',(p['id'],'山')).fetchone()[0]==0
        assert db.execute('SELECT user_description FROM photos WHERE id=?',(q['id'],)).fetchone()==('New note',)
    with closing(sqlite3.connect(incoming)) as db:
        for field in ('user_description','annotation','rejected_ai_tags'):db.execute('ALTER TABLE photos DROP COLUMN '+field)
        db.execute('ALTER TABLE photo_tags DROP COLUMN origin');db.execute('PRAGMA user_version=8');db.commit()
    old=tmp_path/'old-merged.db';merge_libraries(target,incoming,old,tmp_path/'old',tmp_path/'new')
    with closing(sqlite3.connect(old)) as db:
        assert db.execute('SELECT rejected_ai_tags FROM photos WHERE id=?',(q['id'],)).fetchone()==('[]',)
        assert db.execute('SELECT origin FROM photo_tags WHERE photo_id=?',(q['id'],)).fetchone()==('user',)
    assert [digest(v) for v in (first,second)]==before
