from threading import Lock
from time import monotonic
from ..config import SCAN_PATHS
from . import jobs, import_service

_lock = Lock()
_job_id: str | None = None
_started = 0.0

def status() -> dict:
    with _lock:
        job = jobs.get(_job_id) if _job_id else None
    return {'paths': SCAN_PATHS, 'job': job}

def start(force: bool = False) -> dict:
    global _job_id, _started
    with _lock:
        if not SCAN_PATHS:
            return {'paths': [], 'job': None}
        current = jobs.get(_job_id) if _job_id else None
        if current and (current['status'] in ('queued', 'running') or (not force and monotonic()-_started < 60)):
            return {'paths': SCAN_PATHS, 'job': current}
        job = jobs.submit('import', import_service.import_paths, SCAN_PATHS, True, True)
        _job_id, _started = job['id'], monotonic()
        return {'paths': SCAN_PATHS, 'job': job}
