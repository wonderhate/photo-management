"""Synthetic coverage for the fixed AF06/AF64-69/PC18/PC21-22 batch."""
import hashlib
import json
import sqlite3
from pathlib import Path
from uuid import uuid4
import pytest
from sqlalchemy import insert,select
from backend.app.config import DATA
from backend.app.models import Session,Photo,CaptureGroup,RegisteredRawSource
from backend.app.services import derived_recycle,import_service,raw_sources
from test_library import import_paths,wait_job

def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def loaded(client,image_factory):
    path=image_factory();import_paths(client,[path]);return path,client.get('/api/photos').json()['photos'][0]

def test_location_revision_clear_undo_discover_and_source_hash(client,image_factory):
    path,p=loaded(client,image_factory);before=digest(path)
    with Session() as s:
        photo=s.get(Photo,p['id']);photo.gps_latitude=35;photo.gps_longitude=140;s.commit()
    endpoint='/api/locations/photos/'+p['id']
    manual=dict(latitude=None,longitude=None,country='中国',city='杭州',label='西湖',accuracy_m=None)
    result=client.put(endpoint,json=dict(source_hash=before,expected_revision=0,operation='set',value=manual))
    assert result.status_code==200,result.text
    assert result.json()['effective']['source']=='manual' and result.json()['effective']['latitude'] is None
    assert client.get('/api/locations/map').json()['unlocated']==1
    cleared=client.put(endpoint,json=dict(source_hash=before,expected_revision=1,operation='clear'));assert cleared.status_code==200
    assert cleared.json()['effective']['latitude']==35
    assert client.put(endpoint,json=dict(source_hash=before,expected_revision=1,operation='clear')).status_code>=400
    assert client.put(endpoint,json=dict(source_hash=before,expected_revision=2,operation='undo')).status_code==200
    discover=client.get('/api/locations/discover',params={'day':'2026-10-26'}).json()
    assert discover['memories'] and discover['places'][0]['label']=='中国 · 杭州 · 西湖'
    assert digest(path)==before

def test_removal_retains_id_album_draft_graph_and_suppresses_scan_reimport(client,image_factory):
    path,p=loaded(client,image_factory);before=digest(path)
    album=client.post('/api/albums',json={'name':'Preserved','photo_ids':[p['id']]}).json()
    draft=client.post('/api/watermark/drafts',json={'photo_id':p['id'],'name':'Pinned','settings_json':{}}).json()
    assert client.delete('/api/photos/'+p['id']).status_code==200
    assert client.get('/api/photos').json()['total']==0
    assert client.get('/api/locations/map').json()['total']==0
    assert client.get('/api/removals/photos').json()['items'][0]['id']==p['id']
    assert import_service.import_one(path,defer_previews=True,automatic=True)==('skipped',p['id'])
    graph=client.get('/api/assets/graph',params={'kind':'photo','id':p['id']}).json()
    assert any(n['id']==p['id'] and n.get('removed') for n in graph['nodes'])
    assert any(e['kind']=='watermark-source' for e in graph['links'])
    restored=client.post('/api/removals/photos/restore',json={'ids':[p['id']]});assert restored.status_code==200,restored.text
    assert client.get('/api/photos',params={'album_id':album['id']}).json()['photos'][0]['id']==p['id']
    assert client.get('/api/watermark/drafts/'+draft['id']).status_code==200
    assert client.post('/api/removals/photos/restore',json={'ids':[p['id']]}).json()['restored']==0
    assert digest(path)==before

def test_manual_raw_link_hash_and_revision_guard_keep_capture_group(client,image_factory,tmp_path):
    path,p=loaded(client,image_factory);before=digest(path);raw=tmp_path/'same-name.ARW';raw.write_bytes(b'synthetic external RAW bytes');raw_hash=digest(raw)
    record=dict(version=1,id=raw_hash,file_hash=raw_hash,file_name=raw.name,file_size=raw.stat().st_size,path=str(raw),source_id=None,date_taken='2026-01-01T00:00:00',camera_make=None,camera_model='Other camera',lens_model=None,registered_at='2026-10-26T00:00:00.000Z')
    with Session() as s:s.add(RegisteredRawSource(id=raw_hash,record=record));s.commit()
    endpoint='/api/raw-sources/photos/'+p['id'];suggestions=client.get(endpoint).json()
    assert suggestions['record'] is None and suggestions['candidates'][0]['conflicts']
    request=dict(photo_hash=before,expected_revision=0,raw_id=raw_hash,confirmed=True)
    assert client.put(endpoint,json={**request,'confirmed':False}).status_code>=400
    assert client.put(endpoint,json=request).status_code==200
    assert client.put(endpoint,json=request).status_code>=400
    with Session() as s:assert s.get(Photo,p['id']).capture_group_id==p['capture_group_id']
    raw.write_bytes(b'changed external fixture')
    assert client.put(endpoint,json={**request,'expected_revision':1}).status_code>=400
    assert client.put(endpoint,json={**request,'expected_revision':1,'raw_id':None}).status_code==200
    assert digest(path)==before

def test_relink_requires_identical_bytes_and_keeps_originals(client,image_factory,tmp_path):
    path,p=loaded(client,image_factory);before=digest(path);replacement=tmp_path/'relocated.jpg';replacement.write_bytes(path.read_bytes())
    bad=tmp_path/'different.jpg';bad.write_bytes(b'not same')
    endpoint='/api/sources/photos/'+p['id']+'/relink'
    assert client.post(endpoint,json={'path':str(bad)}).status_code>=400
    assert client.post(endpoint,json={'path':str(replacement)}).status_code==200
    with Session() as s:
        photo=s.get(Photo,p['id']);assert photo.file_path==str(replacement.resolve());assert photo.capture_group_id==p['capture_group_id']
    assert digest(path)==digest(replacement)==before

def test_scanner_event_coalescing_tombstones_and_disconnect_preserve_records(client,image_factory,tmp_path,monkeypatch):
    from backend.app.services import scan_service
    source=tmp_path/'watched';source.mkdir();path=source/'source.jpg';path.write_bytes(image_factory().read_bytes());before=digest(path)
    monkeypatch.setattr(scan_service,'SCAN_PATHS',[str(source)])
    monkeypatch.setattr(scan_service,'_known',{});monkeypatch.setattr(scan_service,'_hashes',{})
    first=scan_service.start(force=True);again=scan_service.start(hint=True)
    if first['job']['status'] in ('queued','running'):assert first['job']['id']==again['job']['id']
    wait_job(client,first['job']);p=client.get('/api/photos').json()['photos'][0]
    client.delete('/api/photos/'+p['id'])
    wait_job(client,scan_service.start(force=True)['job']);assert client.get('/api/photos').json()['total']==0
    assert client.get('/api/removals/photos').json()['total']==1
    client.post('/api/removals/photos/restore',json={'ids':[p['id']]})
    original_is_dir=Path.is_dir
    monkeypatch.setattr(Path,'is_dir',lambda self:False if self==source else original_is_dir(self))
    wait_job(client,scan_service.start(force=True)['job'])
    assert scan_service.status()['sources'][0]['state']=='disconnected'
    assert client.get('/api/photos').json()['total']==1 and digest(path)==before

def test_recycle_quarantine_restore_and_no_overwrite_on_conflict(client,image_factory):
    original,_=loaded(client,image_factory);before=digest(original)
    relative=f'assets/variants/{uuid4()}/image.png';path=DATA/relative;path.parent.mkdir(parents=True);path.write_bytes(b'synthetic orphan derived pixels')
    item=dict(path=relative,sha256=digest(path),size=path.stat().st_size)
    listing=derived_recycle.candidates()
    assert any(i['path']==relative for page in range(1,(listing['total']+39)//40+1) for i in derived_recycle.candidates(page)['items'])
    batch=derived_recycle.recycle([item]);assert not path.exists()
    path.write_bytes(b'new conflicting file')
    with pytest.raises(ValueError,match='occupied'):derived_recycle.restore(batch['id'])
    assert path.read_bytes()==b'new conflicting file'
    path.unlink()  # Only this test-owned generated fixture, never an original.
    assert derived_recycle.restore(batch['id'])['restored']==1
    assert digest(path)==item['sha256'];assert digest(original)==before
    with pytest.raises(ValueError):derived_recycle.recycle([dict(path='../original.jpg',sha256=before,size=1)])

def test_partial_quarantine_recovers_complete_source_and_windows_fallback(client,monkeypatch):
    import errno,os
    relative=f'watermark_previews/{uuid4()}-orphan.webp';path=DATA/relative;path.parent.mkdir(exist_ok=True);path.write_bytes(b'complete synthetic pixels')
    item=dict(path=relative,sha256=digest(path),size=path.stat().st_size)
    original_move=derived_recycle._move_no_replace
    def interrupt(source,target,expected):target.write_bytes(b'partial');raise OSError('interrupted')
    monkeypatch.setattr(derived_recycle,'_move_no_replace',interrupt)
    with pytest.raises(OSError):derived_recycle.recycle([item])
    batch=derived_recycle.history()['items'][0]
    assert derived_recycle.restore(batch['id'])['restored']==0 and digest(path)==item['sha256']
    monkeypatch.setattr(derived_recycle,'_move_no_replace',original_move)
    def unsupported(*a,**kw):raise OSError(errno.ENOTSUP,'unsupported hardlink')
    monkeypatch.setattr(os,'link',unsupported)
    moved=derived_recycle.recycle([item]);assert not path.exists()
    derived_recycle.restore(moved['id']);assert digest(path)==item['sha256']

def test_native_map_100000_points_and_dateline(client,tmp_path):
    with Session() as s:
        for start in range(0,100000,2000):
            ids=[f'map-{i}' for i in range(start,start+2000)]
            s.execute(insert(CaptureGroup),[dict(id=id,preferred_photo_id=id) for id in ids])
            s.execute(insert(Photo),[dict(id=id,file_path=str(tmp_path/(id+'.jpg')),file_name=id+'.jpg',file_stem=id,source_directory=str(tmp_path),file_hash=hashlib.sha256(id.encode()).hexdigest(),file_format='JPG',file_size=1,capture_group_id=id,gps_latitude=-89+(i%179),gps_longitude=-179+((i*17)%359)) for i,id in enumerate(ids,start)])
        s.commit()
    summary=client.get('/api/locations/map',params={'count_mode':'file'}).json()
    assert summary['total']==summary['located']==summary['in_view']==100000
    assert summary['truncated'] and len(summary['clusters'])==300
    bounds=dict(west=170,east=-170,south=-10,north=10)
    expected=sum(-10<=-89+(i%179)<=10 and (-179+((i*17)%359)>=170 or -179+((i*17)%359)<=-170) for i in range(100000))
    narrowed=client.get('/api/locations/map',params={'count_mode':'file','viewport':json.dumps(bounds)}).json()
    assert narrowed['in_view']==expected

def test_copy_new_managed_resources_and_interrupted_copy_keeps_old_library(client,image_factory,tmp_path,monkeypatch):
    from backend import migrate_storage
    original,p=loaded(client,image_factory);before=digest(original)
    for folder in ('masks','stickers','media','analysis','recycle'):
        path=DATA/folder/'lifecycle-fixture.bin';path.parent.mkdir(exist_ok=True);path.write_bytes(folder.encode())
    destination=tmp_path/'copy';migrate_storage.migrate(DATA,destination)
    for folder in ('masks','stickers','media','analysis','recycle'):assert (destination/folder/'lifecycle-fixture.bin').read_bytes()==folder.encode()
    with sqlite3.connect(destination/'library.db') as db:assert db.execute('SELECT file_path FROM photos WHERE id=?',(p['id'],)).fetchone()[0]==str(original)
    before_db=digest(DATA/'library.db');copy=migrate_storage.shutil.copy2
    def interrupt(source,target,*args,**kwargs):
        copy(source,target,*args,**kwargs);raise OSError('simulated disk interruption')
    monkeypatch.setattr(migrate_storage.shutil,'copy2',interrupt)
    failed=tmp_path/'interrupted'
    with pytest.raises(OSError):migrate_storage.migrate(DATA,failed)
    assert not failed.exists();assert digest(DATA/'library.db')==before_db;assert digest(original)==before
