from hashlib import sha256
from io import BytesIO
from pathlib import Path
import threading
import time
import multiprocessing
import pytest
from PIL import Image
import numpy as np
from backend.app.config import DATA
from backend.app.services import import_service, display_service, display_worker, jobs


def digest(path):return sha256(path.read_bytes()).hexdigest()
def photo_for(path):
    _,id=import_service.import_one(path)
    return id,digest(path)


@pytest.mark.parametrize('extension',['tiff','heic'])
def test_native_full_display_orientation_no_upscale_and_original_hash(client,tmp_path,extension):
    source=tmp_path/('display.'+extension)
    image=Image.new('RGB',(4600,600),(60,120,180));exif=Image.Exif();exif[274]=6;image.save(source,format='HEIF' if extension=='heic' else 'TIFF',exif=exif.tobytes())
    id,hash=photo_for(source);response=client.post(f'/api/display/{id}/render',params={'source_hash':hash,'edge':4096})
    assert response.status_code==200,response.text[:100]
    assert response.headers['cache-control']=='no-store' and response.headers['x-display-engine']==display_service.ENGINE
    with Image.open(BytesIO(response.content)) as rendered:
        assert rendered.height==4096 and rendered.width==round(600*4096/4600)
        assert rendered.getexif().get(34853) is None
    assert digest(source)==hash
    small=tmp_path/('small.'+extension);Image.new('RGBA',(120,90),(200,100,50,0)).save(small,format='HEIF' if extension=='heic' else 'TIFF');sid,shash=photo_for(small)
    response=client.post(f'/api/display/{sid}/render',params={'source_hash':shash,'edge':6144});assert response.status_code==200
    with Image.open(BytesIO(response.content)) as rendered:
        assert rendered.size==(120,90)
        assert min(rendered.getpixel((30,30)))>245
    assert digest(small)==shash


def test_native_gray_16bit_preserves_range_instead_of_clipping(client,tmp_path):
    source=tmp_path/'gray.tiff';Image.fromarray(np.full((100,180),32768,dtype=np.uint16)).save(source);id,hash=photo_for(source)
    response=client.post(f'/api/display/{id}/render',params={'source_hash':hash,'edge':4096});assert response.status_code==200
    with Image.open(BytesIO(response.content)) as image:assert 126<=image.getpixel((10,10))[0]<=130
    assert digest(source)==hash


def test_native_display_rejects_changed_source_bad_tier_and_unsupported_formats(client,tmp_path):
    source=tmp_path/'changing.tiff';Image.new('RGB',(60,40),'red').save(source);id,hash=photo_for(source);Image.new('RGB',(60,40),'blue').save(source);changed=digest(source)
    assert client.post(f'/api/display/{id}/render',params={'source_hash':hash,'edge':4096}).status_code==409
    assert client.post(f'/api/display/{id}/render',params={'source_hash':'bad','edge':4096}).status_code==422
    assert client.post(f'/api/display/{id}/render',params={'source_hash':hash,'edge':999999}).status_code==422
    assert digest(source)==changed
    other=tmp_path/'worker.png';Image.new('RGB',(40,20),'green').save(other);pid,phash=photo_for(other)
    assert client.post(f'/api/display/{pid}/render',params={'source_hash':phash,'edge':4096}).status_code==422


def slow_decode(*args):time.sleep(30)


def test_native_decoder_cancellation_terminates_process_and_releases_shared_slot(client,tmp_path,monkeypatch):
    source=tmp_path/'cancel.tiff';Image.new('RGB',(60,40),'red').save(source);id,hash=photo_for(source);before={p.pid for p in multiprocessing.active_children()}
    monkeypatch.setattr(display_worker,'render',slow_decode);cancelled=threading.Event();timer=threading.Timer(.5,cancelled.set);timer.start()
    try:
        with pytest.raises(jobs.JobCancelled):display_service.render(id,hash,4096,cancelled)
    finally:timer.cancel()
    assert {p.pid for p in multiprocessing.active_children()}==before
    assert not jobs._display_active and not jobs._display_order
    assert not list((DATA/'previews'/'.display-work').glob('decode-*')) and digest(source)==hash


def test_native_display_waiting_cancel_capacity_and_export_priority(client):
    occupied=threading.Event();release=threading.Event();order=[]
    def export(job_id):occupied.set();release.wait(5);order.append('export')
    root=jobs.submit('export',export,resource='render');assert occupied.wait(2)
    cancelled=threading.Event();done=threading.Event()
    def display():
        try:
            with jobs.display_render_slot(cancelled):order.append('display')
        except jobs.JobCancelled:order.append('cancelled')
        finally:done.set()
    thread=threading.Thread(target=display);thread.start()
    try:
        deadline=time.monotonic()+2
        while not jobs._display_order and time.monotonic()<deadline:time.sleep(.01)
        assert jobs._display_order
        with pytest.raises(ValueError):jobs.freeze_for_switch()
        cancelled.set();assert done.wait(2)
        assert order==['cancelled']
    finally:release.set();thread.join(2)
    deadline=time.monotonic()+2
    while jobs.get(root['id'])['status']=='running' and time.monotonic()<deadline:time.sleep(.01)
    assert order==['cancelled','export'] and not jobs._display_active


def test_native_display_shares_capacity_with_queued_exports_and_admission(client,monkeypatch):
    entered=threading.Event();release=threading.Event();finished=threading.Event();order=[]
    def first(job):entered.set();release.wait(5);order.append('first')
    first_job=jobs.submit('export',first,resource='render');assert entered.wait(2)
    def display():
        with jobs.display_render_slot(threading.Event()):order.append('display')
        finished.set()
    thread=threading.Thread(target=display);thread.start()
    try:
        deadline=time.monotonic()+2
        while not jobs._display_order and time.monotonic()<deadline:time.sleep(.01)
        assert jobs._display_order
        second=jobs.submit('export',lambda job:order.append('second'),resource='render');release.set();assert finished.wait(3)
    finally:release.set();thread.join(3)
    assert order==['first','second','display']
    deadline=time.monotonic()+2
    while jobs.resources()['pending'] and time.monotonic()<deadline:time.sleep(.01)
    monkeypatch.setattr(jobs,'MAX_PENDING',1)
    with jobs.display_render_slot(threading.Event()):
        assert jobs.resources()['pending']==1
        with pytest.raises(ValueError):jobs.freeze_for_switch()
        with pytest.raises(ValueError):jobs.submit('export',lambda job:None,resource='render')
        with pytest.raises(ValueError):
            with jobs.display_render_slot(threading.Event()):pass


def replace_source_after_decode(source,target,edge):
    display_worker.render(source,target,edge)
    Image.new('RGB',(60,40),'blue').save(source)


def test_native_display_rechecks_source_after_decoding(client,tmp_path,monkeypatch):
    source=tmp_path/'changed-during-display.tiff';Image.new('RGB',(60,40),'red').save(source);id,hash=photo_for(source)
    monkeypatch.setattr(display_worker,'render',replace_source_after_decode)
    assert client.post(f'/api/display/{id}/render',params={'source_hash':hash,'edge':4096}).status_code==409
    assert digest(source)!=hash
    with Image.open(source) as image:assert image.getpixel((0,0))==(0,0,255)
    assert not list((DATA/'previews'/'.display-work').glob('decode-*'))


def test_display_route_disconnect_sets_the_physical_cancellation_signal(client,monkeypatch):
    import asyncio
    from fastapi import HTTPException
    from backend.app import display_routes
    observed=threading.Event()
    def waiting(photo_id,source_hash,edge,cancelled):
        assert cancelled.wait(2);observed.set();raise jobs.JobCancelled()
    class Disconnected:
        async def is_disconnected(self):return True
    monkeypatch.setattr(display_service,'render',waiting)
    with pytest.raises(HTTPException) as result:asyncio.run(display_routes.render('test',Disconnected(),'a'*64,'4096'))
    assert result.value.status_code==499 and observed.is_set()
