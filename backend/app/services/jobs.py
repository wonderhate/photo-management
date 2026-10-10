from concurrent.futures import ThreadPoolExecutor
from threading import Lock
from copy import deepcopy
from uuid import uuid4
from typing import Callable
from time import monotonic
from sqlalchemy import select
from ..models import Session, JobRecord, now

_lock = Lock()
_jobs: dict[str, dict] = {}
pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='photo-jobs')
_saved: dict[str,float] = {}

def persist(job_id: str, force: bool = False) -> None:
    # Called with _lock held. Throttle progress; terminal states are always durable.
    if not force and monotonic()-_saved.get(job_id,0)<.5:
        return
    with Session() as session:
        session.merge(JobRecord(id=job_id,payload=deepcopy(_jobs[job_id]),updated_at=now()))
        session.commit()
    _saved[job_id]=monotonic()

def recover() -> None:
    with _lock, Session() as session:
        records=session.scalars(select(JobRecord).order_by(JobRecord.updated_at.desc())).all()
        _jobs.clear();_saved.clear()
        for record in records[:100]:
            payload=record.payload.copy()
            if payload['status'] in ('queued','running'):
                payload.update(status='interrupted',current='',error='程序曾退出，任务已中断；请手动重新执行。已完成的文件保留。')
                record.payload=payload
            _jobs[record.id]=payload
        for record in records[100:]:session.delete(record)
        session.commit()

def recent() -> list[dict]:
    with Session() as session:
        return [record.payload for record in session.scalars(select(JobRecord).order_by(JobRecord.updated_at.desc()).limit(100))]

class JobCancelled(Exception):
    pass

def update(job_id: str, **values) -> None:
    with _lock:
        _jobs[job_id].update(values)
        persist(job_id,values.get('status') in ('completed','failed','cancelled','interrupted'))

def get(job_id: str) -> dict | None:
    with _lock:
        if job_id in _jobs:
            return deepcopy(_jobs[job_id])
    with Session() as session:
        record=session.get(JobRecord,job_id)
        return deepcopy(record.payload) if record else None

def cancel(job_id: str) -> dict | None:
    with _lock:
        job = _jobs.get(job_id)
        if job and job['status'] in ('queued', 'running'):
            job['cancelled'] = True
            persist(job_id,True)
        return deepcopy(job) if job else None

def check(job_id: str) -> None:
    with _lock:
        cancelled = _jobs[job_id].get('cancelled', False)
    if cancelled:
        raise JobCancelled()

def submit(kind: str, function: Callable, *args) -> dict:
    job_id = str(uuid4())
    with _lock:
        _jobs[job_id] = dict(id=job_id, kind=kind, status='queued', total=0, processed=0,
                             success=0, skipped=0, failed=0, current='', errors=[], results=[])
        persist(job_id,True)
        if len(_jobs)>100:
            for old in list(_jobs):
                if len(_jobs)<=100:break
                if old!=job_id and _jobs[old]['status'] not in ('queued','running'):
                    del _jobs[old];_saved.pop(old,None)
                    with Session() as session:
                        record=session.get(JobRecord,old)
                        if record:session.delete(record);session.commit()
    def run() -> None:
        try:
            check(job_id)
            update(job_id, status='running')
            function(job_id, *args)
            update(job_id, status='completed', current='')
        except JobCancelled:
            update(job_id, status='cancelled', current='')
        except Exception as error:
            update(job_id, status='failed', error=str(error))
    pool.submit(run)
    return get(job_id)
