from concurrent.futures import ThreadPoolExecutor
from threading import Lock
from copy import deepcopy
from uuid import uuid4
from typing import Callable

_lock = Lock()
_jobs: dict[str, dict] = {}
pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='photo-jobs')

def update(job_id: str, **values) -> None:
    with _lock:
        _jobs[job_id].update(values)

def get(job_id: str) -> dict | None:
    with _lock:
        return deepcopy(_jobs.get(job_id))

def submit(kind: str, function: Callable, *args) -> dict:
    job_id = str(uuid4())
    with _lock:
        _jobs[job_id] = dict(id=job_id, kind=kind, status='queued', total=0, processed=0,
                             success=0, skipped=0, failed=0, current='', errors=[], results=[])
    def run() -> None:
        update(job_id, status='running')
        try:
            function(job_id, *args)
            update(job_id, status='completed', current='')
        except Exception as error:
            update(job_id, status='failed', error=str(error))
    pool.submit(run)
    return get(job_id)
