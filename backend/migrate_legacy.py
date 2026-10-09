"""Import the earlier Node prototype by reference; preserve all original files."""
import json
from pathlib import Path
from sqlalchemy import select
from backend.app.config import PROJECT
from backend.app.models import initialize, Session, Photo, Album, AlbumPhoto
from backend.app.services.import_service import import_one, file_hash
from backend.app.services.library_service import set_tags

def migrate() -> dict:
    initialize()
    photo_file = PROJECT / 'data' / 'photos.json'
    collection_file = PROJECT / 'data' / 'collections.json'
    if not photo_file.exists(): return {'imported':0,'skipped':0,'failed':[]}
    legacy = json.loads(photo_file.read_text('utf-8')).get('photos',[])
    collections = json.loads(collection_file.read_text('utf-8')).get('collections',[]) if collection_file.exists() else []
    result = {'imported':0,'skipped':0,'failed':[]}
    with Session() as session:
        for collection in collections:
            if collection['id']=='all': continue
            album_id = 'legacy-' + collection['id']
            if not session.get(Album,album_id):
                session.add(Album(id=album_id,name=collection['name'],type='normal'))
        session.commit()
    for record in legacy:
        path = (PROJECT/'uploads'/record['filename']).resolve()
        try:
            outcome = import_one(path)
            result['imported' if outcome=='success' else 'skipped'] += 1
            with Session() as session:
                photo = session.scalar(select(Photo).where(Photo.file_hash==file_hash(path)))
                photo.file_name = record.get('originalName',photo.file_name)
                if record.get('tags'): set_tags(session,photo,record['tags'])
                for collection_id in record.get('collectionIds',[]):
                    album_id='legacy-'+collection_id
                    if session.get(Album,album_id) and not session.get(AlbumPhoto,(album_id,photo.id)):
                        session.add(AlbumPhoto(album_id=album_id,photo_id=photo.id))
                session.commit()
        except Exception as error:
            result['failed'].append({'file':str(path),'error':str(error)})
    return result

if __name__=='__main__':
    print(json.dumps(migrate(),ensure_ascii=True,indent=2))
