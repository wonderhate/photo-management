import hashlib
import json
import os
import threading
import time
from contextlib import nullcontext
from pathlib import Path
from uuid import uuid4

import pytest
from backend.app.models import Session,MediaAsset,Photo
from backend.app.services import video_service as video
from backend.app.services import jobs


@pytest.fixture
def synthetic_video(tmp_path):
    if not video.executable('ffmpeg') or not video.executable('ffprobe'):
        pytest.skip('Local FFmpeg and ffprobe are required for synthetic video integration checks.')
    target=tmp_path/'fixture.mp4'
    video.run_tool('ffmpeg',['-f','lavfi','-i','testsrc2=size=320x240:rate=24',
        '-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1.5',
        '-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart','-y',str(target)],lambda:None)
    return target


@pytest.fixture
def direct_job(monkeypatch):
    updates=[]
    monkeypatch.setattr(jobs,'check',lambda _:None)
    monkeypatch.setattr(jobs,'update',lambda _,**values:updates.append(values))
    monkeypatch.setattr(jobs,'import_render_slot',lambda _:nullcontext())
    return updates


def test_video_import_frames_proxy_and_record_delete_preserve_original(client,synthetic_video,direct_job):
    before=hashlib.sha256(synthetic_video.read_bytes()).hexdigest()
    status,id=video.import_one(synthetic_video,'test')
    assert status=='success' and video.import_one(synthetic_video,'test')==('skipped',id)
    row=client.get('/api/videos/'+id).json()
    assert row['metadata']['audio'] and row['metadata']['width']==320 and row['metadata']['height']==240
    with Session() as session:assert session.query(Photo).count()==0
    assert client.get('/api/videos/'+id+'/cover').headers['content-type']=='image/jpeg'
    first=video.frame(id,3,threading.Event());assert first[:2]==b'\xff\xd8'
    assert video.frame(id,3,threading.Event())==first
    video.render_proxy('test',id,720,True)
    proxy=video.proxy_path(id,720,True);assert proxy.is_file()
    assert video.request_proxy(id,720,True)=={'ready':True,'job':None}
    assert client.get('/api/videos/'+id+'/proxy?edge=720&tone_map=true',headers={'Range':'bytes=0-63'}).status_code==206
    assert hashlib.sha256(synthetic_video.read_bytes()).hexdigest()==before
    assert client.delete('/api/videos/'+id).status_code==200
    assert synthetic_video.is_file() and proxy.is_file()


def test_bad_video_does_not_block_next_import(client,synthetic_video,direct_job,tmp_path):
    broken=tmp_path/'broken.mp4';broken.write_bytes(b'not a video')
    video.import_paths('test',[str(broken),str(synthetic_video)])
    assert direct_job[-1]['failed']==1 and direct_job[-1]['success']==1
    assert client.get('/api/videos').json()['total']==1


def test_changed_original_rejected_before_proxy_and_leave_cancels_frame(client,synthetic_video,direct_job):
    _,id=video.import_one(synthetic_video,'test')
    cancelled=threading.Event();cancelled.set()
    with pytest.raises(jobs.JobCancelled):video.frame(id,7,cancelled)
    synthetic_video.write_bytes(synthetic_video.read_bytes()+b'changed')
    with pytest.raises(ValueError,match='changed'):video.render_proxy('test',id,1080,True)


def test_probe_retains_relative_stream_times_rotation_and_hdr(monkeypatch,tmp_path):
    payload={'format':{'duration':'2'},'streams':[
        {'codec_type':'video','codec_name':'hevc','width':320,'height':240,'avg_frame_rate':'30000/1001','start_time':'1.0','duration':'2','color_transfer':'smpte2084','side_data_list':[{'rotation':90}]},
        {'codec_type':'audio','codec_name':'aac','start_time':'1.1','duration':'1.8'}]}
    monkeypatch.setattr(video,'run_tool',lambda *a,**k:json.dumps(payload).encode())
    metadata=video.probe(tmp_path/'placeholder.mp4',lambda:None)
    assert (metadata['width'],metadata['height'])==(240,320) and metadata['hdr']
    assert metadata['timing']['audio']['start']-metadata['timing']['video']['start']==pytest.approx(.1)


def test_cache_clear_retains_covers_recent_files_and_unrecognized_files(client,monkeypatch,tmp_path):
    def root(kind):
        path=tmp_path/kind;path.mkdir(exist_ok=True);return path
    monkeypatch.setattr(video,'cache_root',root)
    old=root('frames')/('a'*64+'.jpg');old.write_bytes(b'frame');os.utime(old,(time.time()-180,time.time()-180))
    recent=root('proxies')/('b'*64+'.mp4');recent.write_bytes(b'proxy')
    unrelated=root('frames')/'original.jpg';unrelated.write_bytes(b'keep')
    cover=root('covers')/'cover.jpg';cover.write_bytes(b'cover')
    result=client.delete('/api/videos/cache').json()
    assert result['removed']==1 and result['skipped']==1
    assert not old.exists() and recent.exists() and unrelated.exists() and cover.exists()


def test_proxy_request_deduplicates_active_encoder_job(client,monkeypatch,tmp_path):
    monkeypatch.setattr(video,'proxy_path',lambda *args:tmp_path/'proxy.mp4')
    calls=[]
    monkeypatch.setattr(jobs,'submit',lambda *a,**kw:calls.append(a) or {'id':'unique-proxy','status':'queued'})
    monkeypatch.setattr(jobs,'get',lambda id:{'id':id,'status':'queued'})
    a=video.request_proxy('video',1080,True);b=video.request_proxy('video',1080,True)
    assert a==b and len(calls)==1
