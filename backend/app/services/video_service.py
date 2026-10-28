"""Local video records and cancellable FFmpeg derivatives; no original writes."""
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import threading
import time
from pathlib import Path
from tempfile import TemporaryDirectory, TemporaryFile
from fastapi import HTTPException
from sqlalchemy import select
from ..config import DATA
from ..models import MediaAsset, Photo, Session, uid
from . import jobs

EXTENSIONS = {'.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi', '.mts', '.m2ts'}
ENGINE = 'pc-video-1'
MAX_SOURCE_BYTES = 32 * 1024**3
FRAME_BUDGET = 256 * 1024**2
PROXY_BUDGET = 2 * 1024**3
_proxy_lock = threading.Lock()
_proxy_jobs = {}
_cache_lock = threading.Lock()


def executable(name):
    configured = os.environ.get('PHOTO_' + name.upper())
    candidate = Path(configured) if configured else None
    if candidate is not None:
        return str(candidate.resolve()) if candidate.is_absolute() and candidate.is_file() else None
    return shutil.which(name)


def capabilities():
    return {'probe': bool(executable('ffprobe')), 'decode': bool(executable('ffmpeg')),
            'proxy': bool(executable('ffprobe') and executable('ffmpeg')),
            'codec_validation': 'on_request', 'engine': ENGINE,
            'frame_budget_bytes': FRAME_BUDGET, 'proxy_budget_bytes': PROXY_BUDGET}


def run_tool(name, args, check, timeout=60, output_limit=2*1024**2, file_limit=None):
    binary = executable(name)
    if not binary:
        raise ValueError('FFmpeg/ffprobe is unavailable. Configure the local tools to process videos.')
    check()
    with TemporaryFile() as output:
        process = subprocess.Popen([binary, '-v', 'error', *args], stdin=subprocess.DEVNULL,
            stdout=output, stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        started = time.monotonic()
        try:
            while process.poll() is None:
                check()
                if time.monotonic()-started > timeout:
                    raise ValueError('Video processing timed out.')
                if output.tell() > output_limit or file_limit and file_limit[0].exists() and file_limit[0].stat().st_size > file_limit[1]:
                    raise ValueError('Video derivative exceeds the cache budget.')
                time.sleep(.05)
            check()
            if process.returncode:
                raise ValueError('Video decoding failed. The file may be damaged or the local codec unavailable.')
            output.seek(0); result = output.read(output_limit+1)
            if len(result) > output_limit:
                raise ValueError('Video metadata exceeds the size limit.')
            if file_limit and file_limit[0].exists() and file_limit[0].stat().st_size > file_limit[1]:
                raise ValueError('Video derivative exceeds the cache budget.')
            return result
        finally:
            if process.poll() is None: process.kill()
            process.wait()


def finite(value, fallback=0):
    try:
        number = float(value)
        return number if math.isfinite(number) else fallback
    except (ValueError, TypeError): return fallback


def probe(path, check):
    payload = json.loads(run_tool('ffprobe', ['-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm,avi,mpegts', '-max_alloc', '268435456',
        '-show_entries', 'format=duration,format_name:format_tags=creation_time:stream=index,codec_type,codec_name,width,height,avg_frame_rate,pix_fmt,color_space,color_transfer,color_primaries,start_time,duration:stream_tags=rotate,language:stream_side_data=rotation',
        '-of', 'json', str(path)], check))
    streams = payload.get('streams', [])
    video = next((s for s in streams if s.get('codec_type') == 'video' and s.get('width') and s.get('height')), None)
    if not video: raise ValueError('The file contains no usable video stream.')
    width, height = int(video['width']), int(video['height'])
    duration = finite(payload.get('format', {}).get('duration'))
    if width <= 0 or height <= 0 or width*height > 100_000_000 or duration <= 0 or duration > 7*86400:
        raise ValueError('Video dimensions or duration exceed the supported limits.')
    rotation = finite(video.get('tags', {}).get('rotate'))
    for side in video.get('side_data_list', []):
        if 'rotation' in side: rotation = finite(side['rotation'])
    if round(rotation) % 180 == 90: width, height = height, width
    parts = str(video.get('avg_frame_rate', '0/1')).split('/')
    rate = finite(parts[0]) / (finite(parts[1], 1) or 1) if len(parts) == 2 else finite(parts[0])
    audio = next((stream for stream in streams if stream.get('codec_type')=='audio'),None)
    timing = {kind:{'start':finite(stream.get('start_time')), 'duration':finite(stream.get('duration')) or None} for kind,stream in [('video',video),('audio',audio)] if stream}
    return {'timing':timing,'width': width, 'height': height, 'duration': duration, 'fps': max(0, min(rate, 1000)),
        'codec': str(video.get('codec_name', 'unknown'))[:80], 'pixel_format': str(video.get('pix_fmt', 'unknown'))[:80],
        'color_transfer': str(video.get('color_transfer', 'unknown'))[:80],
        'hdr': video.get('color_transfer') in ('smpte2084', 'arib-std-b67'),
        'audio': any(s.get('codec_type') == 'audio' for s in streams),
        'subtitle_tracks': sum(s.get('codec_type') == 'subtitle' for s in streams),
        'rotation': rotation, 'date_taken': str(payload.get('format', {}).get('tags', {}).get('creation_time', ''))[:80]}


def fingerprint(path, check):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024*1024), b''):
            check(); digest.update(block)
    return digest.hexdigest()


def source(asset_id):
    with Session() as session:
        row = session.get(MediaAsset, asset_id)
        if not row: raise HTTPException(404, 'Video not found.')
        path, digest, metadata = Path(row.file_path), row.file_hash, dict(row.metadata_json)
    if not path.is_file(): raise HTTPException(404, 'Video original is missing. Reconnect or reimport it.')
    return path, digest, metadata


def cache_root(kind):
    root = (DATA/'previews'/'videos'/kind).resolve()
    if not root.is_relative_to(DATA.resolve()): raise ValueError('Invalid video cache directory.')
    root.mkdir(parents=True, exist_ok=True)
    return root


def cache_key(digest, options):
    binary = executable('ffmpeg')
    stamp = (Path(binary).stat().st_size, Path(binary).stat().st_mtime_ns) if binary else None
    return hashlib.sha256(json.dumps([ENGINE, stamp, digest, options], sort_keys=True).encode()).hexdigest()


def make_room(root, incoming, budget, keep):
    files = cache_files(root.name)
    size = sum(p.stat().st_size for p in files)
    for path in sorted(files, key=lambda p:p.stat().st_mtime):
        if size+incoming <= budget: break
        # Recently served files may be playing; do not evict an active range stream.
        if path == keep or time.time()-path.stat().st_mtime < 120: continue
        try:
            old_size = path.stat().st_size; path.unlink(); size -= old_size
        except OSError: continue
    if size+incoming > budget: raise ValueError('Video cache is full. Wait for active playback to finish or clear its cache.')


def publish(temp, target, budget):
    with _cache_lock:
        if target.is_file(): return target
        make_room(target.parent, temp.stat().st_size, budget, target)
        temp.replace(target)
    return target


def checked_source(asset_id, check):
    path, digest, metadata = source(asset_id)
    if path.stat().st_size > MAX_SOURCE_BYTES: raise ValueError('Video exceeds the 32 GiB source limit.')
    if fingerprint(path, check) != digest: raise ValueError('Video original changed. Reimport it before processing.')
    return path, digest, metadata


def frame(asset_id, index, cancelled):
    def check():
        if cancelled.is_set(): raise jobs.JobCancelled()
    # The shared render slot bounds heavy decoder work and cooperates with imports.
    with jobs.display_render_slot(cancelled):
        path, digest, metadata = source(asset_id)
        root = cache_root('frames'); target = root/(cache_key(digest, {'frame': index})+'.jpg')
        if target.is_file(): os.utime(target, None); return target.read_bytes()
        path, digest, metadata = checked_source(asset_id, check)
        second = min(metadata['duration']*.95, metadata['duration']*index/8)
        with TemporaryDirectory(prefix='frame-', dir=root) as folder:
            temp = Path(folder)/'frame.jpg'
            run_tool('ffmpeg', ['-nostdin', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm,avi,mpegts', '-ss', str(second), '-i', str(path),
                '-map', '0:v:0', '-frames:v', '1', '-an', '-sn', '-vf', 'scale=640:640:force_original_aspect_ratio=decrease',
                '-q:v', '3', '-y', str(temp)], check, file_limit=(temp, 8*1024**2))
            if fingerprint(path, check) != digest: raise ValueError('Video original changed. Reimport it before processing.')
            return publish(temp, target, FRAME_BUDGET).read_bytes()


def serialize(row):
    return {'id': row.id, 'kind': 'video', 'file_name': row.file_name, 'file_hash': row.file_hash,
        'file_size': row.file_size, 'file_path': row.file_path, 'created_at': row.created_at,
        'metadata': row.metadata_json, 'cover_url': '/api/videos/'+row.id+'/cover',
        'original_url': '/api/videos/'+row.id+'/original', 'missing': not Path(row.file_path).is_file()}


def import_one(path, job_id):
    check = lambda: jobs.check(job_id)
    path = Path(path).resolve(strict=True)
    if not path.is_file() or path.suffix.lower() not in EXTENSIONS: raise ValueError('Unsupported video format.')
    if path.stat().st_size > MAX_SOURCE_BYTES: raise ValueError('Video exceeds the 32 GiB source limit.')
    digest = fingerprint(path, check)
    with Session() as session:
        existing = session.scalar(select(MediaAsset).where(MediaAsset.file_hash == digest))
        if existing:
            if not Path(existing.file_path).exists():
                existing.file_path = str(path); existing.file_name = path.name; session.commit()
            return 'skipped', existing.id
        if session.scalar(select(MediaAsset).where(MediaAsset.file_path == str(path))):
            raise ValueError('Video original changed. Remove its old library record before reimporting.')
    metadata = probe(path, check)
    root = cache_root('covers')
    with TemporaryDirectory(prefix='cover-', dir=root) as folder:
        temp = Path(folder)/'cover.jpg'
        with jobs.import_render_slot(job_id):
            run_tool('ffmpeg', ['-nostdin', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm,avi,mpegts', '-i', str(path), '-map', '0:v:0',
                '-frames:v', '1', '-an', '-sn', '-vf', 'scale=640:640:force_original_aspect_ratio=decrease',
                '-q:v', '3', '-y', str(temp)], check, file_limit=(temp,8*1024**2))
        if fingerprint(path, check) != digest: raise ValueError('Video original changed. Reimport it before processing.')
        id = uid(); cover = root/(id+'.jpg'); temp.replace(cover)
        try:
            with Session() as session:
                session.add(MediaAsset(id=id, kind='video', file_name=path.name, file_path=str(path), file_hash=digest,
                    file_size=path.stat().st_size, metadata_json=metadata, cover_path=str(cover)))
                session.commit()
        except Exception:
            cover.unlink(missing_ok=True); raise
        return 'success', id


def import_paths(job_id, paths):
    counts = {'success': 0, 'skipped': 0, 'failed': 0}; errors=[]; ids=[]
    jobs.update(job_id, total=len(paths))
    for index, value in enumerate(paths):
        jobs.check(job_id)
        try:
            status, id = import_one(value, job_id); counts[status] += 1; ids.append(id)
        except jobs.JobCancelled: raise
        except Exception as error:
            counts['failed'] += 1; errors.append(f'{Path(value).name}: {error}')
        jobs.update(job_id, processed=index+1, **counts, errors=errors[:100], results=[{'video_id':id} for id in ids])


def proxy_path(asset_id, edge, tone_map):
    _, digest, _ = source(asset_id)
    return cache_root('proxies')/(cache_key(digest, {'edge': edge, 'tone_map': tone_map})+'.mp4')


def render_proxy(job_id, asset_id, edge, tone_map):
    check = lambda: jobs.check(job_id)
    path, digest, metadata = checked_source(asset_id, check)
    target = proxy_path(asset_id, edge, tone_map)
    if target.is_file(): jobs.update(job_id, total=1, processed=1, success=1); return
    if metadata['hdr'] and not tone_map:
        raise ValueError('HDR video requires explicit SDR tone mapping for this compatibility proxy.')
    filters=[]
    if metadata['hdr']:
        filters += ['zscale=t=linear:npl=100', 'format=gbrpf32le', 'zscale=p=bt709', 'tonemap=hable:desat=0', 'zscale=t=bt709:m=bt709:r=tv']
    # Do not upscale small videos; even dimensions are required by yuv420p.
    filters += [f"scale=w='min({edge},iw)':h='min({edge},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2", 'setsar=1', 'format=yuv420p']
    with TemporaryDirectory(prefix='proxy-', dir=target.parent) as folder:
        temp = Path(folder)/'proxy.mp4'
        jobs.update(job_id, total=1, current='Creating compatibility video')
        run_tool('ffmpeg', ['-nostdin', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm,avi,mpegts', '-i', str(path), '-map', '0:v:0', '-map', '0:a:0?',
            '-vf', ','.join(filters), '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-c:a', 'aac', '-b:a', '160k',
            '-sn', '-map_metadata', '-1', '-movflags', '+faststart', '-y', str(temp)], check,
            timeout=6*3600, file_limit=(temp, PROXY_BUDGET))
        result = probe(temp, check)
        if max(result['width'], result['height']) > edge or abs(result['duration']-metadata['duration']) > max(1, 2/max(1, metadata['fps'])):
            raise ValueError('Compatibility video dimensions or duration do not match the source.')
        # Compare stream starts and ends relative to video. Container duration alone
        # cannot detect audio dropped or shifted by an encoder.
        if result['audio']!=metadata['audio']:
            raise ValueError('Compatibility video lost its audio stream.')
        original_timing=metadata.get('timing') or probe(path,check)['timing']
        output_timing=result['timing']
        if metadata['audio']:
            tolerance=max(.12,2/max(1,metadata['fps']))
            for field in ('start','end'):
                def relative(timing):
                    a,v=timing['audio'],timing['video']
                    if field=='end':
                        if a['duration'] is None or v['duration'] is None:return None
                        return a['start']+a['duration']-v['start']-v['duration']
                    return a['start']-v['start']
                before,after=relative(original_timing),relative(output_timing)
                if before is not None and after is not None and abs(before-after)>tolerance:
                    raise ValueError('Compatibility video audio timing differs from the source.')
        if fingerprint(path, check) != digest: raise ValueError('Video original changed. Reimport it before processing.')
        check(); publish(temp, target, PROXY_BUDGET)
    jobs.update(job_id, processed=1, success=1, results=[{'video_id':asset_id, 'url':f'/api/videos/{asset_id}/proxy?edge={edge}&tone_map={str(tone_map).lower()}'}])


def request_proxy(asset_id, edge, tone_map):
    target = proxy_path(asset_id, edge, tone_map)
    if target.is_file(): return {'ready': True, 'job': None}
    key = str(target)
    with _proxy_lock:
        prior = jobs.get(_proxy_jobs[key]) if key in _proxy_jobs else None
        if prior and prior['status'] in jobs.ACTIVE: return {'ready': False, 'job': prior}
        job = jobs.submit('video-proxy', render_proxy, asset_id, edge, tone_map, resource='render')
        _proxy_jobs[key] = job['id']
        # Task history has its own retention; do not retain unrelated keys forever.
        for old_key in list(_proxy_jobs):
            if old_key != key and not (jobs.get(_proxy_jobs[old_key]) or {}).get('status') in jobs.ACTIVE:
                del _proxy_jobs[old_key]
        return {'ready': False, 'job': job}


def cache_files(kind):
    root=cache_root(kind)
    suffix='.jpg' if kind=='frames' else '.mp4'
    with Session() as session:
        originals={Path(value).resolve() for model in (MediaAsset,Photo) for value in session.scalars(select(model.file_path))}
    return [p for p in root.iterdir() if not p.is_symlink() and p.is_file() and p.resolve() not in originals and re.fullmatch(r'[a-f0-9]{64}'+re.escape(suffix),p.name)]


def cache_status():
    with _cache_lock:
        values={}
        for kind,budget in [('frames',FRAME_BUDGET),('proxies',PROXY_BUDGET)]:
            files=cache_files(kind)
            values[kind]={'bytes':sum(p.stat().st_size for p in files),'files':len(files),'budget_bytes':budget}
        return values


def clear_cache():
    removed=skipped=0
    with _cache_lock:
        for kind in ('frames','proxies'):
            for path in cache_files(kind):
                # Covers are library assets, and in-progress temporary directories
                # belong to their jobs. Neither is part of this cleanup.
                try:
                    if time.time()-path.stat().st_mtime<120:skipped+=1;continue
                    path.unlink();removed+=1
                except OSError:skipped+=1
    return {'removed':removed,'skipped':skipped,'originals_untouched':True,'cache':cache_status()}
