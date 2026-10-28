from contextlib import closing
import sqlite3
from backend.app.config import DATA
from backend.app.migrations import backup_database, migrate_database
from backend.library_maintenance import merge_libraries
from test_library import import_paths


def test_old_schema_upgrade_is_idempotent_and_backed_up(tmp_path):
    path = tmp_path / 'old.db'
    with sqlite3.connect(path) as db:
        db.execute('CREATE TABLE photos (id TEXT PRIMARY KEY)')
        db.execute('CREATE TABLE albums (id TEXT PRIMARY KEY)')
        db.execute('CREATE TABLE album_photos (album_id TEXT,photo_id TEXT)')
        db.execute("INSERT INTO photos VALUES ('preserved')")
    changes = migrate_database(path)
    assert len(changes) == 41 and {'source_decode_profile:v2','ai_profiles','ai_results','vision_assets'} <= set(changes)
    assert {'registered_raw_sources','photo_raw_relations','photo_locations'} <= set(changes)
    assert {'edit_documents', 'asset_variants', 'library_profile', 'document_view_preferences','lut_assets','collage_projects'} <= set(changes)
    assert migrate_database(path) == []
    backups = list((tmp_path / 'backups').glob('*.db'))
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as db:
        assert [r[1] for r in db.execute('PRAGMA table_info(photos)')] == ['id']
    with sqlite3.connect(path) as db:
        assert db.execute('SELECT id FROM photos').fetchone()[0] == 'preserved'


def test_library_merge_preserves_records_draft_and_originals(client, image_factory, tmp_path):
    first = image_factory('first.jpg')
    second = image_factory('second.jpg', color=(10,20,30))
    import_paths(client,[first])
    target = backup_database(DATA/'library.db', tmp_path/'target.db')
    with sqlite3.connect(target) as db:
        db.execute("UPDATE photos SET face_data='null'")
    import_paths(client,[second])
    photo = client.get('/api/photos').json()['photos'][0]
    draft = client.post('/api/watermark/drafts',json={'photo_id':photo['id'],'name':'保留草稿','settings_json':{}})
    assert draft.status_code == 201, draft.text
    from backend.app.models import Session, Photo, FacePerson, DetectedFace
    first_id = next(p['id'] for p in client.get('/api/photos').json()['photos'] if p['file_name'] == first.name)
    with Session() as session:
        person = FacePerson(name='保留人物')
        session.add(person); session.flush()
        session.get(Photo, first_id).face_data = {'model':'test-face-model','count':1}
        session.add(DetectedFace(photo_id=first_id, person_id=person.id, face_index=0,
            encoding=b'feature', location={'left':0,'top':0,'right':1,'bottom':1}, confirmed=True))
        session.commit()
    album=client.post('/api/albums',json={'name':'关联人物影集','person_id':person.id}).json()
    rule_query={'version':1,'root':{'op':'is_null','field':'rating'}}
    rule=client.post('/api/albums',json={'name':'Rule collection','type':'rule','query':rule_query}).json()
    with closing(sqlite3.connect(DATA/'library.db')) as db:
        joined=db.execute('SELECT photo_id,added_at FROM album_photos WHERE album_id=?',(album['id'],)).fetchall()
        assert joined and all(date for _,date in joined)
    source = backup_database(DATA/'library.db', tmp_path/'source.db')
    before = {p: p.read_bytes() for p in (first,second)}
    stage = tmp_path/'stage.db'
    result = merge_libraries(target,source,stage,tmp_path/'unrelated',tmp_path/'relocated')
    assert result['files'] == 2 and result['added'] == 1 and result['drafts'] == 1
    assert result['missing'] == [] and result['integrity'] == 'ok'
    with sqlite3.connect(target) as db:
        assert db.execute('SELECT count(*) FROM photos').fetchone()[0] == 1
    with sqlite3.connect(stage) as db:
        assert db.execute('SELECT photo_id,added_at FROM album_photos WHERE album_id=?',(album['id'],)).fetchall()==joined
        assert db.execute('SELECT name FROM watermark_drafts').fetchone()[0] == '保留草稿'
        assert db.execute('SELECT name, confirmed FROM detected_faces JOIN face_persons ON person_id=face_persons.id').fetchone() == ('保留人物', 1)
        assert db.execute('SELECT a.name,p.name FROM albums a JOIN face_persons p ON a.person_id=p.id WHERE a.id=?',(album['id'],)).fetchone()==('关联人物影集','保留人物')
        import json
        row=db.execute('SELECT type,query FROM albums WHERE id=?',(rule['id'],)).fetchone()
        assert row[0]=='rule' and json.loads(row[1])==rule_query
        assert json.loads(db.execute('SELECT face_data FROM photos WHERE id=?', (first_id,)).fetchone()[0])['count'] == 1
    with sqlite3.connect(target) as db:
        db.execute('UPDATE photos SET face_data=? WHERE id=?', ('{"model":"test-face-model","count":0}', first_id))
    preserved_stage = tmp_path/'preserved-stage.db'
    merge_libraries(target,source,preserved_stage,tmp_path/'unrelated',tmp_path/'relocated')
    with sqlite3.connect(preserved_stage) as db:
        assert db.execute('SELECT count(*) FROM detected_faces').fetchone()[0] == 0
    assert all(p.read_bytes() == value for p,value in before.items())
