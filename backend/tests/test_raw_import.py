"""Public RAW fixtures and isolated libraries; no personal originals or AI calls."""
from contextlib import contextmanager
from hashlib import sha256
import json
import multiprocessing
import os
from pathlib import Path
import shutil
import struct
from threading import Event
import time
import pytest
from PIL import Image
from backend.app.config import DATA
from backend.app.services import import_service, jobs, raw_preview_service, raw_preview_worker
from test_library import import_paths
from test_progressive_import import drained, eventually

ORIGINAL_RENDER=raw_preview_worker.render
FIXTURES=Path(__file__).resolve().parents[2]/'.test-artifacts'/'raw-fixtures'
RECORDS=json.loads((Path(__file__).resolve().parents[2]/'frontend/tests/raw-fixtures.json').read_text('utf-8'))


def digest(path):return sha256(path.read_bytes()).hexdigest()


def sample(tmp_path,extension):
    record=next(r for r in RECORDS if r['name']=='sample.'+extension)
    source=FIXTURES/record['name']
    if not source.is_file():pytest.skip('Fetch the documented public RAW fixtures first')
    assert source.stat().st_size==record['bytes'] and digest(source)==record['sha256']
    target=tmp_path/record['name'];shutil.copyfile(source,target);return target


def outputs(photo_id):
    return [DATA/folder/(photo_id+'.jpg') for folder in ('previews','thumbnails')]


def test_four_real_raw_formats_keep_full_source_geometry_and_embedded_or_decode_paths(client,tmp_path,monkeypatch):
    drained();paths=[sample(tmp_path,ext) for ext in ('CR2','NEF','ARW','DNG')];before=[digest(p) for p in paths]
    prepare=raw_preview_service.prepare;reports={}
    @contextmanager
    def observe(source,job_id):
        with prepare(source,job_id) as values:
            reports[source.suffix]=json.loads((Path(values['preview_path']).parent/'result.json').read_text('utf-8'))
            yield values
    monkeypatch.setattr(raw_preview_service,'prepare',observe)
    result=import_paths(client,paths);drained()
    assert result['success']==result['preview_processed']==4 and result['preview_failed']==0
    photos=client.get('/api/photos?count_mode=file').json()['photos'];assert len(photos)==4
    for photo in photos:
        report=reports[Path(photo['file_name']).suffix]
        assert photo['is_raw'] and photo['preview_status']=='ready'
        assert (photo['width'],photo['height'])==(report['width'],report['height'])
        for path,edge in zip(outputs(photo['id']),(2560,560)):
            with Image.open(path) as image:
                assert image.format=='JPEG' and max(image.size)<=edge
                assert image.getexif().get(34853) is None
        if photo['file_name'].endswith('.DNG'):
            assert (photo['width'],photo['height'])==(256,168)
            # This lossy RGB DNG retains its full size even with half_size=True.
            with Image.open(outputs(photo['id'])[0]) as image:assert image.size==(256,168)
    assert reports['.DNG']['source']=='decoded-raw'
    assert all(reports['.'+ext]['source']=='embedded-jpeg' for ext in ('CR2','NEF','ARW'))
    assert [digest(p) for p in paths]==before
    assert not list((DATA/'previews'/'.raw-import').glob('decode-*'))


def test_portrait_raw_uses_full_oriented_dimensions_and_rotates_embedded_jpeg_once(client,tmp_path):
    source=sample(tmp_path,'NEF');public_hash=digest(FIXTURES/'sample.NEF')
    data=bytearray(source.read_bytes());order='<' if data[:2]==b'II' else '>'
    offset=struct.unpack_from(order+'I',data,4)[0];count=struct.unpack_from(order+'H',data,offset)[0];changed=False
    for index in range(count):
        at=offset+2+index*12
        if struct.unpack_from(order+'H',data,at)[0]==274:
            struct.pack_into(order+'H',data,at+8,6);changed=True;break
    assert changed;source.write_bytes(data);before=digest(source)
    result=import_paths(client,[source]);drained();assert result['preview_failed']==0
    photo=client.get('/api/photos').json()['photos'][0]
    assert (photo['width'],photo['height'],photo['orientation'])==(2844,4284,6)
    with Image.open(outputs(photo['id'])[0]) as image:assert image.height==2560 and image.width<image.height
    assert digest(source)==before and digest(FIXTURES/'sample.NEF')==public_hash


def slow_render(*args):time.sleep(30)


def test_active_raw_cancel_physically_stops_child_cleans_staging_and_yields_export_then_repairs(client,tmp_path,monkeypatch):
    drained();source=sample(tmp_path,'DNG');before=digest(source);children={p.pid for p in multiprocessing.active_children()}
    monkeypatch.setattr(raw_preview_worker,'render',slow_render)
    root=client.post('/api/photos/import',json={'paths':[str(source)]}).json()
    eventually(lambda:bool({p.pid for p in multiprocessing.active_children()}-children))
    assert any(r['name']=='render' and r['running']==1 for r in jobs.resources()['items'])
    with pytest.raises(ValueError):jobs.freeze_for_switch()
    exported=Event();following=jobs.submit('export',lambda job:exported.set(),resource='render')
    started=time.monotonic();jobs.cancel(root['id']);assert exported.wait(3);drained()
    assert time.monotonic()-started<3 and jobs.get(root['id'])['status']=='cancelled'
    assert jobs.get(following['id'])['status']=='completed'
    assert {p.pid for p in multiprocessing.active_children()}==children and not jobs._render_leases
    photo=client.get('/api/photos').json()['photos'][0]
    assert photo['preview_status']=='pending' and photo['preview_error'] is None
    assert all(not p.exists() for p in outputs(photo['id']))
    assert not list((DATA/'previews'/'.raw-import').glob('decode-*'))
    monkeypatch.setattr(raw_preview_worker,'render',ORIGINAL_RENDER)
    repaired=import_paths(client,[source]);drained()
    assert repaired['skipped']==1 and repaired['preview_failed']==0
    assert client.get('/api/photos/'+photo['id']).json()['preview_status']=='ready' and digest(source)==before


def change_source_after_render(source,folder,quality):
    ORIGINAL_RENDER(source,folder,quality)
    source=Path(source);stat=source.stat();data=bytearray(source.read_bytes());data[-1]^=1;source.write_bytes(data)
    os.utime(source,ns=(stat.st_atime_ns,stat.st_mtime_ns))


def test_changed_raw_with_same_size_and_mtime_cannot_publish_and_explicit_rescan_repairs(client,tmp_path,monkeypatch):
    source=sample(tmp_path,'DNG');before=source.read_bytes();stat=source.stat()
    monkeypatch.setattr(raw_preview_worker,'render',change_source_after_render)
    result=import_paths(client,[source]);drained();assert result['preview_failed']==1
    assert source.stat().st_size==stat.st_size and source.stat().st_mtime_ns==stat.st_mtime_ns
    photo=client.get('/api/photos').json()['photos'][0]
    assert photo['preview_status']=='failed' and '原片已变化' in photo['preview_error']
    assert all(not p.exists() for p in outputs(photo['id']))
    source.write_bytes(before);monkeypatch.setattr(raw_preview_worker,'render',ORIGINAL_RENDER)
    result=import_paths(client,[source]);drained();assert result['skipped']==1 and result['preview_failed']==0
    assert client.get('/api/photos/'+photo['id']).json()['preview_status']=='ready' and source.read_bytes()==before


def test_deleted_raw_is_not_restored_and_staged_outputs_are_discarded(client,tmp_path,monkeypatch):
    source=sample(tmp_path,'DNG');before=digest(source);prepare=raw_preview_service.prepare;ready=Event();release=Event()
    @contextmanager
    def held(*args):
        with prepare(*args) as values:
            ready.set();assert release.wait(5);yield values
    monkeypatch.setattr(raw_preview_service,'prepare',held)
    root=client.post('/api/photos/import',json={'paths':[str(source)]}).json()
    try:
        assert ready.wait(3);photo=client.get('/api/photos').json()['photos'][0]
        assert client.delete('/api/photos/'+photo['id']).status_code==200
    finally:release.set();drained()
    assert jobs.get(root['id'])['status']=='completed' and client.get('/api/photos').json()['total']==0
    assert all(not p.exists() for p in outputs(photo['id'])) and digest(source)==before
    assert not list((DATA/'previews'/'.raw-import').glob('decode-*'))


def test_raw_timeout_releases_child_and_oversize_is_rejected_before_spawn(client,tmp_path,monkeypatch):
    drained();source=sample(tmp_path,'DNG');before=digest(source);children={p.pid for p in multiprocessing.active_children()}
    monkeypatch.setattr(raw_preview_worker,'render',slow_render);monkeypatch.setattr(raw_preview_service,'TIMEOUT',.1)
    result=import_paths(client,[source]);drained();assert result['preview_failed']==1
    photo=client.get('/api/photos').json()['photos'][0];assert '超时' in photo['preview_error']
    assert {p.pid for p in multiprocessing.active_children()}==children and not jobs._render_leases
    monkeypatch.setattr(raw_preview_worker,'MAX_BYTES',1)
    result=import_paths(client,[source]);drained();assert result['preview_failed']==1
    assert '256 MiB' in client.get('/api/photos/'+photo['id']).json()['preview_error']
    assert all(not p.exists() for p in outputs(photo['id'])) and digest(source)==before
    assert not list((DATA/'previews'/'.raw-import').glob('decode-*'))
