"""Synthetic-only fixtures for local appearance and semantic suggestions."""
from io import BytesIO
import hashlib
import numpy as np
from PIL import Image,ImageDraw
from backend.app.services.visual_hash import fingerprint,HashIndex
from backend.app.services import similarity_service
from backend.app.services.embedding_service import service
from backend.app.models import Session,Photo,VisualFingerprint
from sqlalchemy import select
from test_library import import_paths


def scene():
    image=Image.new('RGB',(256,192),(185,210,235));draw=ImageDraw.Draw(image)
    draw.polygon([(0,120),(90,30),(150,130)],fill=(30,65,50))
    draw.rectangle((0,145,256,192),fill=(40,90,130));draw.ellipse((175,20,210,55),fill=(245,180,55))
    return image


def test_hash_candidates_are_exact_hamming_neighbors_with_stable_ties():
    rng=np.random.default_rng(42)
    entries=[(f'{i:04}',f'{int(value):016x}') for i,value in enumerate(rng.integers(0,2**63,size=600,dtype=np.uint64))]
    entries += [('same-a',entries[0][1]),('same-b',entries[0][1])]
    index=HashIndex(entries)
    for radius in (0,3,6,12,16):
        value=int(entries[0][1],16)
        expected=sorted(((int(encoded,16)^value).bit_count(),identifier) for identifier,encoded in entries if (int(encoded,16)^value).bit_count()<=radius)
        assert index.candidates(entries[0][1],radius)==expected


def test_reencoding_and_resize_keep_appearance_while_new_scene_is_distinct():
    with scene() as source:
        original=fingerprint(source);out=BytesIO();source.save(out,'JPEG',quality=65)
        with Image.open(BytesIO(out.getvalue())) as jpeg:encoded=fingerprint(jpeg)
        with source.resize((512,384)) as bigger:resized=fingerprint(bigger)
        with source.crop((45,25,230,180)).resize(source.size) as cropped:crop=fingerprint(cropped)
    with Image.new('RGB',(256,192),'white') as other:
        draw=ImageDraw.Draw(other)
        for x in range(0,256,32):draw.rectangle((x,0,x+14,192),fill='black')
        different=fingerprint(other)
    distance=lambda record:(int(original['phash'],16)^int(record['phash'],16)).bit_count()
    assert distance(encoded)<=6 and distance(resized)<=6
    assert distance(different)>6
    # Cropping is measured, never promised to be invariant or auto-deleted.
    assert 0<=distance(crop)<=63
    assert len(original['palette'])<=6 and original['contrast']>2
    with Image.new('RGB',(32,32),'white') as white:assert fingerprint(white)['contrast']<2


def test_explicit_appearance_index_keeps_originals_and_deduplicates_captures(client,image_factory,monkeypatch):
    first=image_factory('appearance-a.jpg');second=first.parent/'appearance-b.jpg'
    with scene() as image:image.save(first,'JPEG',quality=95);image.save(second,'JPEG',quality=80)
    before={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in (first,second)}
    import_paths(client,[first,second])
    monkeypatch.setattr(similarity_service.jobs,'update',lambda *a,**k:None)
    monkeypatch.setattr(similarity_service.jobs,'check',lambda *a:None)
    similarity_service.index_library('synthetic-explicit-job')
    with Session() as session:
        photos=session.scalars(select(Photo)).all();source=photos[0]
        session.add(Photo(id='raw-member',file_name='a.DNG',file_path=str(first.parent/'a.DNG'),file_stem='a',source_directory=str(first.parent),file_hash='f'*64,file_format='DNG',file_size=0,is_raw=True,capture_group_id=source.capture_group_id))
        session.commit();source_id=source.id
        assert len(session.scalars(select(VisualFingerprint)).all())==2
    result=client.get('/api/similarity/photos/raw-member').json()
    assert result['source_id']==source_id and len(result['candidates'])==1
    assert result['candidates'][0]['id']!=source_id and result['verified_with_clip'] is False
    assert client.get('/api/similarity/photos/raw-member?distance=17').status_code==422
    assert before=={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in (first,second)}
    with Session() as session:assert len(session.scalars(select(Photo)).all())==3
    palette=client.get('/api/similarity/photos/'+source_id+'/analysis').json()['palette']
    client.patch('/api/photos/'+source_id,json={'favorite':True,'color_label':'red','flag':'picked'})
    filtered=client.get('/api/photos/ids',params={'analyzed_color':palette[0],'count_mode':'file'}).json()['ids']
    assert source_id in filtered and 'raw-member' in filtered
    record=client.get('/api/photos/'+source_id).json()
    assert record['favorite'] and record['color_label']=='red' and record['flag']=='picked'
    pairs=client.get('/api/similarity/groups?limit=1').json()
    assert len(pairs['groups'])==1
    group=pairs['groups'][0]
    assert group['source']['id']<group['candidates'][0]['id']
    following=client.get('/api/similarity/groups',params={'after':pairs['next_cursor']}).json()
    assert following['groups']==[] and not following['has_more']


def test_copy_merge_and_downgrade_preserve_appearance_provenance(client,image_factory,monkeypatch,tmp_path):
    import sqlite3,json,pytest
    from backend.app.config import DATA
    from backend.app.migrations import backup_database,migrate_database
    from backend.library_maintenance import merge_libraries
    from backend.migrate_storage import migrate
    empty=backup_database(DATA/'library.db',tmp_path/'empty.db')
    source=image_factory('appearance-copy.jpg');digest=hashlib.sha256(source.read_bytes()).hexdigest()
    import_paths(client,[source]);monkeypatch.setattr(similarity_service.jobs,'update',lambda *a,**k:None);monkeypatch.setattr(similarity_service.jobs,'check',lambda *a:None)
    similarity_service.index_library('synthetic-copy')
    with Session() as session:record=session.scalars(select(VisualFingerprint)).one().record
    copied=tmp_path/'copy';migrate(DATA,copied)
    stage=tmp_path/'merged.db';merge_libraries(empty,DATA/'library.db',stage,DATA,DATA)
    for database in (stage,copied/'library.db'):
        with sqlite3.connect(database) as db:
            assert json.loads(db.execute('SELECT record FROM visual_fingerprints').fetchone()[0])==record
            assert not db.execute('PRAGMA foreign_key_check').fetchall()
    with sqlite3.connect(stage) as db:db.execute('PRAGMA user_version=24')
    before=stage.read_bytes()
    with pytest.raises(ValueError,match='Appearance'):migrate_database(stage)
    assert stage.read_bytes()==before and hashlib.sha256(source.read_bytes()).hexdigest()==digest


def test_smart_rematch_retains_manual_members_and_saved_keyword_settings(client,image_factory,monkeypatch):
    import_paths(client,[image_factory('manual.jpg'),image_factory('new.jpg',color=(5,11,23))])
    ids=client.get('/api/photos/ids').json()['ids']
    album=client.post('/api/albums/smart/create',json={'name':'saved','type':'smart','keywords':['海岸'],'match_mode':'all','threshold':-.1,'max_results':75,'photo_ids':[ids[0]]}).json()
    seen=[]
    def search(*args):seen.append(args);return [{'photo_id':ids[1],'similarity_score':.75}]
    monkeypatch.setattr(service,'search',search)
    result=client.post('/api/albums/'+album['id']+'/rerun').json()
    assert result['selected_photo_ids']==[ids[0]]
    assert {p['id'] for p in result['candidates']}==set(ids)
    assert seen==[(['海岸'],'all',-.1,75)]
    # Merely asking for a preview cannot rewrite confirmed members.
    assert client.get('/api/photos/ids',params={'album_id':album['id']}).json()['ids']==[ids[0]]
    saved=client.get('/api/albums/'+album['id']).json()
    assert (saved['keywords'],saved['threshold'],saved['match_mode'],saved['max_results'])==(['海岸'],-.1,'all',75)


def test_cancelled_appearance_index_keeps_published_rows_and_never_writes_originals(client,image_factory,monkeypatch):
    import pytest
    paths=[image_factory('cancel-a.jpg'),image_factory('cancel-b.jpg',color=(23,50,90))]
    before=[hashlib.sha256(p.read_bytes()).hexdigest() for p in paths];import_paths(client,paths)
    checks=0
    def check(_):
        nonlocal checks
        checks+=1
        if checks==3:raise similarity_service.jobs.JobCancelled()
    monkeypatch.setattr(similarity_service.jobs,'check',check);monkeypatch.setattr(similarity_service.jobs,'update',lambda *a,**k:None)
    with pytest.raises(similarity_service.jobs.JobCancelled):similarity_service.index_library('cancel-fixture')
    with Session() as session:assert len(session.scalars(select(VisualFingerprint)).all())==1
    monkeypatch.setattr(similarity_service.jobs,'check',lambda *a:None);similarity_service.index_library('resume-fixture')
    with Session() as session:assert len(session.scalars(select(VisualFingerprint)).all())==2
    assert before==[hashlib.sha256(p.read_bytes()).hexdigest() for p in paths]
