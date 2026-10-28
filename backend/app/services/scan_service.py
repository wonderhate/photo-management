"""Coalesced source scans. Disconnects and changed bytes never delete library records."""
import os
from pathlib import Path
from threading import Event, Lock, Thread
from time import monotonic
from sqlalchemy import select
from ..config import SCAN_PATHS, DATA, MODELS, EXPORTS, EXTENSIONS
from ..models import Session, Photo, now
from . import jobs, import_service
from .directory_hints import DirectoryHints

_lock=Lock()
_job_id=None
_started=0.0
_thread=None
_stop=Event()
_known={}
_hashes={}
_sources=[]
PERIOD_SECONDS=300
COALESCE_SECONDS=2


def status():
    with _lock:
        return {'paths':list(SCAN_PATHS),'job':jobs.get(_job_id) if _job_id else None,
                'sources':[dict(s) for s in _sources],'interval_seconds':PERIOD_SECONDS,
                'event_hints':os.name=='nt','monitoring':bool(_thread and _thread.is_alive())}


def _key(path):return os.path.normcase(str(path.resolve()))


def _signature(path):
    value=path.stat()
    return value.st_size,value.st_mtime_ns,value.st_ctime_ns


def _scan(job_id, force=False):
    from .export_registry import registered_files
    paths=list(SCAN_PATHS)
    excluded=[MODELS.resolve(),EXPORTS.resolve()]
    for base in [DATA,import_service.DATA,*map(Path,paths)]:
        excluded.extend((base/name).resolve() for name in ('thumbnails','watermark_previews','previews','embeddings','exports','export-records','artworks','documents','assets','backups','recycle','media-cache','imports','ai-studio'))
    generated={_key(p) for p in registered_files()}
    with Session() as session:
        records=[(p.id,p.removed_original_path if p.removed_at else p.file_path,p.file_hash,bool(p.removed_at))
                 for p in session.execute(select(Photo.id,Photo.file_path,Photo.removed_original_path,Photo.file_hash,Photo.removed_at).execution_options(include_removed=True))]
    removed={_key(Path(path)) for _,path,_,hidden in records if hidden and path}
    signatures={};candidates={};summaries=[];hashes={}
    def blocked(path):
        resolved=path.resolve()
        return path.is_symlink() or getattr(path,'is_junction',lambda:False)() or _key(resolved) in generated or any(resolved==d or d in resolved.parents for d in excluded)
    for root in paths:
        jobs.check(job_id);folder=Path(root)
        state={'path':root,'state':'connected','checked_at':now(),'files':0,'missing':0,'changed':0,'removed':0,'errors':0,'missing_ids':[],'changed_ids':[]}
        seen=set();errors=[]
        if not folder.is_dir():state['state']='disconnected'
        elif blocked(folder):state['state']='excluded'
        else:
            for parent,dirs,names in os.walk(folder,followlinks=False,onerror=lambda e:errors.append(e)):
                jobs.check(job_id)
                dirs[:]=[name for name in dirs if not blocked(Path(parent)/name)]
                for index,name in enumerate(names):
                    if index%128==0:jobs.check(job_id)
                    path=Path(parent)/name
                    if path.suffix.lower() not in EXTENSIONS or blocked(path):continue
                    key=_key(path);seen.add(key);state['files']+=1
                    if key in removed:state['removed']+=1;continue
                    try:signature=_signature(path)
                    except OSError as error:errors.append(error);continue
                    signatures[key]=signature
                    if force or _known.get(key)!=signature:candidates[key]=path
            if errors:state['state']='partial';state['errors']=len(errors)
            for photo_id,path,digest,hidden in records:
                if hidden or not path or not Path(path).is_relative_to(folder):continue
                key=_key(Path(path))
                if key not in seen:
                    state['missing']+=1
                    if len(state['missing_ids'])<100:state['missing_ids'].append(photo_id)
                else:
                    try:
                        observed=import_service.file_hash(Path(path),job_id) if key in candidates else _hashes.get(key)
                        hashes[key]=observed
                        if observed is not None and observed!=digest:
                            state['changed']+=1
                            if len(state['changed_ids'])<100:state['changed_ids'].append(photo_id)
                    except OSError:state['errors']+=1;state['state']='partial'
        summaries.append(state)
    # Existing import code verifies hashes and relinks missing same-hash sources.
    # Recheck tombstones at import time, including removals during enumeration.
    import_service.import_paths(job_id,[str(p) for p in candidates.values()],False,True,automatic=True)
    jobs.check(job_id)
    with _lock:
        _known.clear();_known.update(signatures)
        _hashes.clear();_hashes.update(hashes)
        _sources[:]=summaries


def start(force=False, hint=False):
    global _job_id,_started
    from .. import runtime_control
    with _lock:
        current=jobs.get(_job_id) if _job_id else None
        if not SCAN_PATHS or runtime_control.snapshot()['switching']:return {'paths':list(SCAN_PATHS),'job':current}
        if current and (current['status'] in ('queued','running') or not force and not hint and monotonic()-_started<60):return {'paths':list(SCAN_PATHS),'job':current}
        job=jobs.submit('import',_scan,force)
        _job_id,_started=job['id'],monotonic()
        return {'paths':list(SCAN_PATHS),'job':job}


def _monitor():
    hints=DirectoryHints();last=monotonic();pending=None
    try:
        while not _stop.wait(1):
            tick=monotonic()
            try:changed=hints.poll(SCAN_PATHS)
            except OSError:changed=False
            if changed and pending is None:pending=tick
            if tick-last>=PERIOD_SECONDS or pending is not None and tick-pending>=COALESCE_SECONDS:
                with _lock:active=jobs.get(_job_id) if _job_id else None
                if active and active['status'] in ('queued','running'):continue
                try:start(force=False,hint=True)
                except Exception:continue  # Unavailable storage is retried, never cleared.
                if monotonic()-_started<2:last=tick;pending=None
    finally:hints.close()


def start_monitor():
    global _thread
    start()
    with _lock:
        if _thread and _thread.is_alive():return
        _stop.clear();_thread=Thread(target=_monitor,name='photo-source-monitor',daemon=True);_thread.start()


def stop_monitor():
    _stop.set()
    if _thread:_thread.join(timeout=3)
