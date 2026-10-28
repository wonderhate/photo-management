from backend.app.migrations import SCHEMA_VERSION
import hashlib
import json
import sqlite3
from contextlib import closing
from pathlib import Path
from PIL import Image
from sqlalchemy import select
from backend.app.models import Session,Photo
from backend.app.config import DATA
from backend.app.migrations import backup_database,migrate_database
from backend.app.services import rating_service,metadata_service
from test_library import import_paths
from test_metadata import write_xmp,digest
from test_progressive_import import drained

CONTRACT=json.loads((Path(__file__).resolve().parents[2]/'frontend/tests/fixtures/photo-rating.json').read_text(encoding='utf-8'))

def test_xmp_rating_contract_matches_browser():
    for value,expected in CONTRACT['values']:assert rating_service.xmp_rating(value)==expected
    for row in CONTRACT['cases']:assert rating_service.external_rating(row['raw'])==row['expected']

def imported(client,source):
    result=import_paths(client,[source]);drained();assert result['success']==1
    return next(p for p in client.get('/api/photos').json()['photos'] if p['file_name']==source.name)

def test_first_import_uses_sidecar_zero_without_changing_geometry_or_other_annotations(client,tmp_path):
    source=tmp_path/'rated.jpg';packet=write_xmp(tmp_path/'embedded.xmp','xmp:Rating="4"').read_bytes()
    Image.new('RGB',(80,40),'teal').save(source,xmp=packet)
    shared=write_xmp(source.with_suffix('.xmp'),'xmp:Rating="5" xmp:Label="Red"')
    specific=write_xmp(source.with_name(source.name+'.xmp'),'xmp:Rating="0" tiff:Orientation="6"')
    before=[digest(p) for p in (source,shared,specific)];p=imported(client,source)
    assert p['rating']==0 and p['rating_source']=='xmp-sidecar'
    assert (p['favorite'],p['color_label'],p['tags'],p['width'],p['height'])==(False,None,[],80,40)
    assert [digest(p) for p in (source,shared,specific)]==before

def test_rescan_and_refresh_preserve_manual_ratings_zero_and_clears(client,image_factory,monkeypatch):
    source=image_factory('manual.jpg');sidecar=write_xmp(source.with_suffix('.xmp'),'xmp:Rating="5"');before=digest(source);p=imported(client,source)
    assert p['rating']==5 and p['rating_source']=='xmp-sidecar'
    refresh=lambda:client.post('/api/photos/'+p['id']+'/rating/refresh')
    write_xmp(sidecar,'xmp:Rating="2"');side_before=digest(sidecar);rescan=import_paths(client,[source]);drained();assert rescan['skipped']==1
    assert client.get('/api/photos/'+p['id']).json()['rating']==5
    result=refresh().json();assert result['status']=='updated' and result['photo']['rating']==2
    for rating in (None,0,3):
        response=client.patch('/api/photos/'+p['id'],json={'rating':rating,'color_label':'blue','tags':['manual']});assert response.json()['rating_source']=='manual'
        import_paths(client,[source]);drained();result=refresh().json()
        assert result['status']=='protected' and result['photo']['rating']==rating and result['external']['rating']==2
        assert result['photo']['color_label']=='blue' and result['photo']['tags']==['manual']
    for payload in ({'rating':0},{'clear_rating':True}):
        client.post('/api/photos/batch-edit',json={'photo_ids':[p['id']],**payload});result=refresh().json()
        assert result['status']=='protected' and result['photo']['rating']==payload.get('rating') and result['photo']['rating_source']=='manual'
    assert digest(source)==before and digest(sidecar)==side_before
    # A later file joining an existing RAW/JPEG capture must inherit the clear.
    from backend.app.services import import_service
    metadata=metadata_service.extract(source);raw=source.with_suffix('.DNG');raw.write_bytes(b'synthetic metadata-only RAW');raw_before=digest(raw)
    with monkeypatch.context() as patch:
        patch.setattr(metadata_service,'extract',lambda *args,**kwargs:dict(metadata))
        state,new_id=import_service.import_one(raw,defer_previews=True)
    assert state=='success'
    with Session() as session:
        added=session.get(Photo,new_id);assert (added.capture_group_id,added.rating,added.rating_source)==(p['capture_group_id'],None,'manual')
    assert digest(source)==before and digest(raw)==raw_before

def test_refresh_keeps_a_new_manual_decision_and_rejects_changed_original(client,image_factory,monkeypatch):
    source=image_factory('race.jpg');sidecar=write_xmp(source.with_suffix('.xmp'),'xmp:Rating="5"');p=imported(client,source);before=digest(source);side_before=digest(sidecar);extract=metadata_service.extract
    def read_then_clear(*args,**kwargs):
        result=extract(*args,**kwargs)
        with Session() as session:
            fresh=session.get(Photo,p['id']);fresh.rating=None;fresh.rating_source='manual';session.commit()
        return result
    monkeypatch.setattr(metadata_service,'extract',read_then_clear)
    r=client.post('/api/photos/'+p['id']+'/rating/refresh');assert r.status_code==200 and r.json()['status']=='protected' and r.json()['photo']['rating'] is None
    assert digest(source)==before and digest(sidecar)==side_before
    source.write_bytes(source.read_bytes()+b'synthetic changed source');changed=digest(source)
    r=client.post('/api/photos/'+p['id']+'/rating/refresh');assert r.status_code==400
    assert client.get('/api/photos/'+p['id']).json()['rating'] is None and digest(source)==changed

def test_missing_or_invalid_external_rating_does_not_clear_stars_and_new_sidecar_is_found(client,image_factory):
    source=image_factory('late-sidecar.jpg');p=imported(client,source);assert p['rating'] is None and p['rating_source']=='none'
    endpoint='/api/photos/'+p['id']+'/rating/refresh';assert client.post(endpoint).json()['status']=='not_found'
    sidecar=write_xmp(source.with_suffix('.xmp'),'xmp:Rating="4"');assert client.post(endpoint).json()['photo']['rating']==4
    for value in ('-1','6','bad'):
        write_xmp(sidecar,'xmp:Rating="'+value+'"');before=digest(sidecar);r=client.post(endpoint).json();assert r['status']=='not_found' and r['photo']['rating']==4 and digest(sidecar)==before

def test_schema_six_migration_protects_unknown_legacy_ratings_including_null(client,image_factory,tmp_path,monkeypatch):
    source=image_factory('old-stars.jpg');before=digest(source);p=imported(client,source)
    path=backup_database(DATA/'library.db',tmp_path/'rating-v6.db')
    with closing(sqlite3.connect(path)) as db:
        db.execute('ALTER TABLE photos DROP COLUMN rating_source');db.execute('PRAGMA user_version=6');db.commit()
    from backend.app import migrations
    import pytest
    snapshot=path.read_bytes()
    with monkeypatch.context() as patch:
        def fail_backup(*args,**kwargs):raise OSError('Synthetic rating backup failure')
        patch.setattr(migrations,'backup_database',fail_backup)
        with pytest.raises(OSError):migrate_database(path)
    assert path.read_bytes()==snapshot
    assert migrate_database(path)==['photos.rating_source'];assert migrate_database(path)==[]
    with closing(sqlite3.connect(path)) as db:
        assert db.execute('SELECT rating,rating_source FROM photos WHERE id=?',(p['id'],)).fetchone()==(None,'legacy')
        assert db.execute('PRAGMA user_version').fetchone()[0]==SCHEMA_VERSION
    backups=list((tmp_path/'backups').glob('*.db'));assert len(backups)==1
    with closing(sqlite3.connect(backups[0])) as db:assert 'rating_source' not in [r[1] for r in db.execute('PRAGMA table_info(photos)')]
    with Session() as session:
        photo=session.get(Photo,p['id']);photo.rating_source='legacy';session.commit()
    write_xmp(source.with_suffix('.xmp'),'xmp:Rating="5"');result=client.post('/api/photos/'+p['id']+'/rating/refresh').json();assert result['status']=='protected' and result['photo']['rating'] is None
    assert digest(source)==before

def test_merge_protects_manual_and_legacy_clears_and_keeps_old_source_rows_readable(client,image_factory,tmp_path):
    from backend.library_maintenance import merge_libraries
    first=image_factory('merge-stars.jpg');write_xmp(first.with_suffix('.xmp'),'xmp:Rating="5"');p=imported(client,first)
    target=backup_database(DATA/'library.db',tmp_path/'target.db')
    second=image_factory('new-legacy-stars.jpg',color=(10,30,80));q=imported(client,second)
    source=backup_database(DATA/'library.db',tmp_path/'source.db');before=[digest(f) for f in (first,second)]
    for origin in ('manual','legacy','none'):
        with closing(sqlite3.connect(target)) as db:db.execute('UPDATE photos SET rating=NULL,rating_source=?',(origin,));db.commit()
        stage=tmp_path/(origin+'.db');merge_libraries(target,source,stage,tmp_path/'unrelated',tmp_path/'relocated')
        with closing(sqlite3.connect(stage)) as db:
            value=db.execute('SELECT rating,rating_source FROM photos WHERE id=?',(p['id'],)).fetchone()
            assert value==((5,'xmp-sidecar') if origin=='none' else (None,origin))
    old=backup_database(source,tmp_path/'source-v6.db')
    with closing(sqlite3.connect(old)) as db:db.execute('ALTER TABLE photos DROP COLUMN rating_source');db.execute('DROP INDEX ix_photos_flag');db.execute('ALTER TABLE photos DROP COLUMN flag');db.execute('PRAGMA user_version=6');db.commit()
    with closing(sqlite3.connect(target)) as db:db.execute("UPDATE photos SET rating=NULL,rating_source='manual'");db.commit()
    stage=tmp_path/'old-source.db';merge_libraries(target,old,stage,tmp_path/'unrelated',tmp_path/'relocated')
    with closing(sqlite3.connect(stage)) as db:
        assert db.execute('SELECT rating,rating_source FROM photos WHERE id=?',(p['id'],)).fetchone()==(None,'manual')
        assert db.execute('SELECT rating,rating_source FROM photos WHERE id=?',(q['id'],)).fetchone()==(None,'legacy')
    assert [digest(f) for f in (first,second)]==before
