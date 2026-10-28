import copy
import hashlib
import json
import sqlite3
from pathlib import Path

from backend.app.config import DATA
from backend.app.models import Session,MediaAsset,FrameLibraryAsset
from backend.app.migrations import backup_database,SCHEMA_VERSION
from backend.library_maintenance import merge_libraries
from backend.migrate_storage import migrate
from test_frame_v2 import document


def test_copy_and_merge_retain_frames_videos_and_external_originals(client,tmp_path):
    target=backup_database(DATA/'library.db',tmp_path/'empty.db')
    original=tmp_path/'external.mp4';original.write_bytes(b'synthetic source for storage-only checks')
    digest=hashlib.sha256(original.read_bytes()).hexdigest()
    cover=DATA/'previews/videos/covers/video-fixture.jpg';cover.parent.mkdir(parents=True,exist_ok=True)
    from PIL import Image
    Image.new('RGB',(40,30),'blue').save(cover)
    record=dict(version=2,id='frame-migration',name='Retained frame',template=document()['template'],margin=1,text_scale=1)
    with Session() as session:
        session.add(FrameLibraryAsset(id=record['id'],kind='templates',record=record))
        session.add(MediaAsset(id='video-fixture',kind='video',file_path=str(original),file_name=original.name,file_hash=digest,file_size=original.stat().st_size,metadata_json={'width':40,'height':30,'duration':1,'fps':24,'codec':'h264'},cover_path=str(cover)))
        session.commit()
    copied=tmp_path/'copied';migrate(DATA,copied)
    with sqlite3.connect(copied/'library.db') as db:
        assert db.execute('PRAGMA user_version').fetchone()[0]==SCHEMA_VERSION
        assert json.loads(db.execute('SELECT record FROM frame_library_assets').fetchone()[0])==record
        source_path,cover_path=db.execute('SELECT file_path,cover_path FROM media_assets').fetchone()
        assert source_path==str(original) and Path(cover_path).is_relative_to(copied)
        assert Path(cover_path).read_bytes()==cover.read_bytes()
    stage=tmp_path/'merged.db';merge_libraries(target,DATA/'library.db',stage,DATA,DATA)
    with sqlite3.connect(stage) as db:
        assert db.execute('SELECT count(*) FROM media_assets').fetchone()[0]==1
        assert json.loads(db.execute('SELECT record FROM frame_library_assets').fetchone()[0])==record
    assert hashlib.sha256(original.read_bytes()).hexdigest()==digest
