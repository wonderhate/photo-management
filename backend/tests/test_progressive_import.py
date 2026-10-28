import hashlib
import time
from threading import Event
from backend.app.services import jobs, import_service, thumbnail_service
from test_library import import_paths


def drained():
    deadline=time.monotonic()+8
    while jobs.resources()['pending'] and time.monotonic()<deadline:time.sleep(.01)
    assert jobs.resources()['pending']==0


def eventually(condition):
    deadline=time.monotonic()+5
    while not condition() and time.monotonic()<deadline:time.sleep(.01)
    assert condition()


def sources(factory,count):return [factory(f'progressive-{i:03}.jpg',color=(i%255,(i*17)%255,(i*59)%255)) for i in range(count)]
def hashes(paths):return [hashlib.sha256(path.read_bytes()).hexdigest() for path in paths]


def test_first_screen_and_hundred_file_batches_publish_metadata_before_preview_and_keep_total(client,image_factory,monkeypatch):
    drained();paths=sources(image_factory,127);before=hashes(paths);started=Event();release=Event();calls=[];boundaries=[];generate=thumbnail_service.generate
    monkeypatch.setattr(import_service,'PREVIEW_BATCH_SECONDS',1_000_000)
    def hold(path,id):
        calls.append(id)
        if len(calls) in (1,25,125):boundaries.append(client.get('/api/photos').json()['total'])
        if len(calls)==1:started.set();assert release.wait(8)
        return generate(path,id)
    monkeypatch.setattr(thumbnail_service,'generate',hold)
    root=client.post('/api/photos/import',json={'paths':[str(p) for p in paths]}).json()
    try:
        assert started.wait(5)
        listing=client.get('/api/photos',params={'page_size':200}).json();assert listing['total']==24
        assert all(p['preview_status']=='pending' and p['thumbnail_url']=='' for p in listing['photos'])
        state=jobs.get(root['id']);assert state['total']==127 and state['processed']==state['success']==24
        target=listing['photos'][0]
        assert client.patch('/api/photos/'+target['id'],json={'rating':4,'favorite':True,'tags':['during import']}).status_code==200
        assert client.get('/api/photos',params={'favorite':'true','rating':4}).json()['total']==1
        assert client.post('/api/albums',json={'name':'during import','photo_ids':[target['id']]}).status_code==200
        assert not release.is_set()  # All interactions completed while image decoding was blocked.
    finally:release.set();drained()
    state=jobs.get(root['id']);assert state['status']=='completed' and state['processed']==state['total']==state['success']==127
    assert state['preview_processed']==state['preview_total']==127 and state['preview_failed']==0
    assert len(calls)==127 and boundaries==[24,124,127] and client.get('/api/photos?rating=4').json()['total']==1
    assert hashes(paths)==before


def test_eight_second_boundary_is_independent_of_batch_size(client,image_factory,monkeypatch):
    drained();paths=sources(image_factory,3);started=Event();release=Event();clock=[0];admitted=[0];when=[]
    inspect=import_service.import_one;generate=thumbnail_service.generate
    monkeypatch.setattr(import_service,'monotonic',lambda:clock[0])
    def register(*args,**kwargs):
        result=inspect(*args,**kwargs);admitted[0]+=1;clock[0]+=4;return result
    def hold(path,id):
        when.append(admitted[0])
        if len(when)==1:started.set();assert release.wait(8)
        return generate(path,id)
    monkeypatch.setattr(import_service,'import_one',register);monkeypatch.setattr(thumbnail_service,'generate',hold)
    root=client.post('/api/photos/import',json={'paths':[str(p) for p in paths]}).json()
    try:
        assert started.wait(3);assert client.get('/api/photos').json()['total']==2
        assert jobs.get(root['id'])['total']==3 and jobs.get(root['id'])['preview_total']==2
    finally:release.set();drained()
    assert when==[2,2,3] and jobs.get(root['id'])['processed']==3


def test_cancel_waiting_for_render_keeps_indexed_photos_and_explicit_reimport_repairs(client,image_factory,monkeypatch):
    drained();paths=sources(image_factory,3);before=hashes(paths);started=Event();release=Event();calls=[];generate=thumbnail_service.generate
    def blocked(_id):started.set();assert release.wait(8)
    def record(path,id):calls.append(id);return generate(path,id)
    monkeypatch.setattr(thumbnail_service,'generate',record)
    exported=jobs.submit('export',blocked);assert started.wait(3)
    root=client.post('/api/photos/import',json={'paths':[str(p) for p in paths]}).json()
    try:
        eventually(lambda:any(i['name']=='render' and i['queued']==1 for i in jobs.resources()['items']))
        stages=jobs.children(root['id'])['items'];assert [j['kind'] for j in stages]==['import-scan','import-index','import-preview']
        assert stages[1]['status']=='completed' and stages[2]['status']=='queued'
        jobs.cancel(stages[2]['id']);eventually(lambda:jobs.get(root['id'])['status']=='cancelled')
        assert calls==[] and client.get('/api/photos').json()['total']==3
        assert jobs.get(stages[1]['id'])['status']=='completed'
    finally:release.set();drained()
    assert jobs.get(exported['id'])['status']=='completed'
    repaired=import_paths(client,paths);drained()
    assert repaired['success']==0 and repaired['skipped']==3 and repaired['preview_total']==repaired['preview_processed']==3
    assert all(p['preview_status']=='ready' for p in client.get('/api/photos').json()['photos']) and hashes(paths)==before


def test_running_cancel_finishes_current_preview_and_yields_render_to_export(client,image_factory,monkeypatch):
    drained();paths=sources(image_factory,3);before=hashes(paths);started=Event();release=Event();export_started=Event();calls=[];generate=thumbnail_service.generate
    def hold(path,id):
        calls.append(id)
        if len(calls)==1:started.set();assert release.wait(8)
        return generate(path,id)
    monkeypatch.setattr(thumbnail_service,'generate',hold)
    root=client.post('/api/photos/import',json={'paths':[str(p) for p in paths]}).json()
    try:
        assert started.wait(3)
        exported=jobs.submit('export',lambda _id:export_started.set());assert jobs.get(exported['id'])['status']=='queued'
        jobs.cancel(root['id']);assert any(i['name']=='render' and i['running']==1 for i in jobs.resources()['items'])
        release.set();assert export_started.wait(3);drained()
        assert jobs.get(root['id'])['status']=='cancelled' and jobs.get(root['id'])['preview_processed']==1
        assert len(calls)==1 and sum(p['preview_status']=='ready' for p in client.get('/api/photos').json()['photos'])==1
        assert hashes(paths)==before
    finally:release.set();drained()


def test_preview_update_does_not_restore_deleted_records_or_overwrite_user_annotations(client,image_factory,monkeypatch):
    drained();paths=sources(image_factory,3);before=hashes(paths);started=Event();release=Event();calls=[];generate=thumbnail_service.generate
    def hold(path,id):
        calls.append(id)
        if len(calls)==1:started.set();assert release.wait(8)
        return generate(path,id)
    monkeypatch.setattr(thumbnail_service,'generate',hold)
    root=client.post('/api/photos/import',json={'paths':[str(p) for p in paths]}).json()
    try:
        assert started.wait(3)
        photo=next(p for p in client.get('/api/photos').json()['photos'] if p['id']!=calls[0])
        assert client.patch('/api/photos/'+photo['id'],json={'rating':5,'tags':['manual']}).status_code==200
        assert client.delete('/api/photos/'+calls[0]).status_code==200
    finally:release.set();drained()
    assert client.get('/api/photos/'+calls[0]).status_code==404
    saved=client.get('/api/photos/'+photo['id']).json();assert saved['rating']==5 and saved['tags']==['manual'] and saved['preview_status']=='ready'
    assert client.get('/api/photos').json()['total']==2 and hashes(paths)==before


def test_later_paired_file_keeps_annotations_entered_while_only_the_raw_was_visible(client,image_factory):
    jpeg=image_factory('paired-later.jpg');raw=jpeg.with_suffix('.ARW');raw.write_bytes(b'synthetic metadata-only RAW');before=hashes([raw,jpeg])
    import_paths(client,[raw]);drained();first=client.get('/api/photos').json()['photos'][0]
    assert client.patch('/api/photos/'+first['id'],json={'rating':4,'favorite':True,'color_label':'red','tags':['manual before pairing']}).status_code==200
    import_paths(client,[jpeg]);drained()
    listing=client.get('/api/photos?favorite=true&rating=4').json();assert listing['total']==1
    preferred=listing['photos'][0];assert preferred['file_name']==jpeg.name and preferred['color_label']=='red' and preferred['tags']==['manual before pairing']
    assert client.get('/api/photos',params={'tag':'manual before pairing'}).json()['total']==1 and hashes([raw,jpeg])==before
