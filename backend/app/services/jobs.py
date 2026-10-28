"""Durable local task trees with bounded, independently scheduled resources."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from threading import Lock, Condition
from collections import deque
from copy import deepcopy
from uuid import uuid4
from typing import Callable
from time import monotonic
from sqlalchemy import select
from ..models import Session, JobRecord, LibraryProfile, now

_lock = Lock()
_resource_changed=Condition(_lock)
_render_leases=set()
_render_waiters=set()
_display_active=set()
_display_order=deque()
_jobs: dict[str, dict] = {}
_saved: dict[str,float] = {}
RESOURCE_LIMITS = {'io':1, 'render':1, 'local-ai':1, 'cloud':1, 'network':1, 'agent':1}
MAX_PENDING = 64
HISTORY_ROOTS = 100
MAX_CHILDREN = 16
pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='photo-jobs')
_pools = {'io':pool, **{name:ThreadPoolExecutor(max_workers=limit,thread_name_prefix='photo-'+name)
                       for name,limit in RESOURCE_LIMITS.items() if name!='io'}}
_queued = {name:deque() for name in RESOURCE_LIMITS}
_work: dict[str,tuple] = {}
_running: set[str] = set()
_pending = 0
_accepting = True
_scheduled: set[str] = set()
ACTIVE = ('queued','running','awaiting_approval','awaiting_app','paused')
MIRRORED = {'total','processed','success','skipped','failed','current','errors','results','photo_ids',
            'photo_id','artwork_id','suggestions','phase','stage','billing_state','request_id','provider','model'}
SUMMARY_FIELDS = ('id','kind','status','total','processed','success','skipped','failed','current',
    'phase','stage','cancelled','parent_id','resource','billable','billing_state','billing_uncertain','request_id','provider','model','child_count','active_child_id','preview_total','preview_processed','preview_failed')

class JobCancelled(Exception):
    pass

def persist(job_id: str, force: bool = False) -> None:
    # Called with _lock held. Terminal/submission changes bypass progress throttling.
    if not force and monotonic()-_saved.get(job_id,0)<.5:return
    with Session() as session:
        session.merge(JobRecord(id=job_id,payload=deepcopy(_jobs[job_id]),updated_at=now()))
        session.commit()
    _saved[job_id]=monotonic()

def _trim() -> None:
    roots=[j for j in _jobs.values() if not j.get('parent_id')]
    finished=[j for j in roots if j['status'] not in ACTIVE and j['id'] not in _scheduled]
    finished.sort(key=lambda j:j.get('finished_at',''))
    for root in finished[:-HISTORY_ROOTS] if len(finished)>HISTORY_ROOTS else []:
        family=[key for key,j in _jobs.items() if key==root['id'] or j.get('parent_id')==root['id']]
        with Session() as session:
            for key in family:
                _jobs.pop(key,None);_saved.pop(key,None)
                record=session.get(JobRecord,key)
                if record:session.delete(record)
            session.commit()

def recover() -> None:
    with _lock, Session() as session:
        records=session.scalars(select(JobRecord).order_by(JobRecord.updated_at)).all()
        _jobs.clear();_saved.clear()
        for record in records:
            payload=deepcopy(record.payload)
            if payload['status'] not in ACTIVE:payload.setdefault('finished_at',record.updated_at)
            if payload['status'] in ACTIVE:
                cloud=payload.get('billable') or payload.get('kind','').startswith('watercolor')
                payload.update(status='interrupted',current='',active_child_id=None,
                    error='程序曾退出，任务已中断；已完成的文件保留，不会自动重新执行。')
                if cloud and payload.get('billing_state') not in ('responded','not_submitted'):
                    payload.update(billing_state='unknown',billing_uncertain=True)
                record.payload=payload
            _jobs[record.id]=payload
        for payload in _jobs.values():
            parent=_jobs.get(payload.get('parent_id'))
            if parent is not None and payload.get('billing_uncertain'):
                parent['billing_uncertain']=True
                session.get(JobRecord,parent['id']).payload=deepcopy(parent)
        session.commit()
        _trim()

def _summary(payload, updated_at=None):
    return {key:payload[key] for key in SUMMARY_FIELDS if key in payload} | {
        'updated_at':updated_at,'error_count':len(payload.get('errors',[])),
        'result_count':len(payload.get('results',[]))}

def recent(summary: bool = False) -> list[dict]:
    with Session() as session:
        records=session.scalars(select(JobRecord).order_by(JobRecord.updated_at.desc())).all()
        ids={r.id for r in records}
        roots=[r for r in records if not r.payload.get('parent_id') or r.payload['parent_id'] not in ids]
        roots.sort(key=lambda r:r.payload['status'] not in ACTIVE)
        return [_summary(r.payload,r.updated_at) if summary else deepcopy(r.payload) for r in roots[:100]]

def children(job_id: str, page=1, page_size=20) -> dict:
    with Session() as session:
        records=session.scalars(select(JobRecord).where(JobRecord.payload['parent_id'].as_string()==job_id)
            .order_by(JobRecord.updated_at,JobRecord.id)).all()
        records=[record for _,record in sorted(enumerate(records),key=lambda pair:pair[1].payload.get('stage_index',pair[0]))]
        return {'items':[_summary(r.payload,r.updated_at) for r in records[(page-1)*page_size:page*page_size]],
                'total':len(records)}

def update(job_id: str, **values) -> None:
    with _lock:
        job=_jobs[job_id];previous_status=job['status'];job.update(deepcopy(values))
        if values.get('status') in ('completed','failed','cancelled','interrupted'):job['finished_at']=now()
        if values.get('billing_state')=='unknown':job['billing_uncertain']=True
        force=previous_status!=job['status'] or values.get('status') in ('completed','failed','cancelled','interrupted') or 'billing_state' in values or 'request_id' in values
        persist(job_id,force)
        parent=job.get('parent_id')
        if parent in _jobs:
            if job.get('billing_uncertain'):_jobs[parent]['billing_uncertain']=True
            fields=MIRRORED if job.get('mirror_progress') else {'current','billing_state'}
            _jobs[parent].update({key:deepcopy(value) for key,value in values.items() if key in fields})
            persist(parent,force)

def get(job_id: str) -> dict | None:
    with _lock:
        if job_id in _jobs:return deepcopy(_jobs[job_id])
    with Session() as session:
        record=session.get(JobRecord,job_id)
        return deepcopy(record.payload) if record else None

def cancel(job_id: str) -> dict | None:
    global _pending
    with _lock:
        job=_jobs.get(job_id)
        if job and job['status'] in ACTIVE:
            root_id=job.get('parent_id') or job_id
            for key,value in _jobs.items():
                if (key==root_id or value.get('parent_id')==root_id) and value['status'] in ACTIVE:
                    value['cancelled']=True
                    if value['status']!='running':value.update(status='cancelled',current='',finished_at=now())
                    persist(key,True)
            if root_id in _scheduled and root_id not in _running:
                resource=_jobs[root_id]['resource']
                _queued[resource].remove(root_id)
                _work.pop(root_id,None);_scheduled.discard(root_id);_pending-=1
                _trim()
        return deepcopy(job) if job else None

def check(job_id: str) -> None:
    with _lock:
        job=_jobs[job_id];parent=_jobs.get(job.get('parent_id'),{})
        cancelled=job.get('cancelled',False) or parent.get('cancelled',False) or job['status']=='interrupted' or parent.get('status')=='interrupted'
    if cancelled:raise JobCancelled()

def mark_submitted(job_id: str) -> None:
    # Cancellation and the durable submission boundary share the same lock.
    # Once committed, a later cancel cannot promise to prevent remote billing.
    with _lock:
        job=_jobs[job_id];parent=_jobs.get(job.get('parent_id'))
        if job.get('cancelled') or job['status']=='interrupted' or parent and (parent.get('cancelled') or parent['status']=='interrupted'):
            raise JobCancelled()
        job['billing_state']='submitted';persist(job_id,True)
        if parent is not None:
            parent['billing_state']='submitted';persist(parent['id'],True)

@contextmanager
def stage(parent_id: str, kind: str, *, mirror=True, total=0, resource=None):
    check(parent_id)
    child_id=str(uuid4())
    with _lock:
        parent=_jobs[parent_id]
        if parent.get('parent_id'):raise ValueError('Only one stage level is supported')
        if parent.get('child_count',0)>=MAX_CHILDREN:raise ValueError('Too many task stages')
        _jobs[child_id]=dict(id=child_id,kind=kind,status='running',total=total,processed=0,success=0,
            skipped=0,failed=0,current='',errors=[],results=[],parent_id=parent_id,resource=resource or parent['resource'],
            billable=parent['billable'],billing_state='not_submitted' if parent['billable'] else None,
            mirror_progress=mirror,scope=deepcopy(parent.get('scope',{})),stage_index=parent.get('child_count',0))
        parent.update(child_count=parent.get('child_count',0)+1,active_child_id=child_id)
        persist(child_id,True);persist(parent_id,True)
    try:
        check(child_id)
        yield child_id
        check(child_id)
        update(child_id,status='completed',current='')
    except JobCancelled:
        if get(child_id)['status']!='completed':update(child_id,status='cancelled',current='')
        raise
    except Exception as error:
        if get(child_id)['status']!='completed':update(child_id,status='failed',error=str(error))
        raise
    finally:
        with _lock:
            if _jobs[parent_id].get('active_child_id')==child_id:
                _jobs[parent_id]['active_child_id']=None;persist(parent_id,True)

def resources() -> dict:
    with _lock:
        roots=[j for j in _jobs.values() if not j.get('parent_id')]
        return {'capacity':MAX_PENDING,'pending':_pending+len(_display_active),'items':[
            {'name':name,'limit':limit,'running':sum(j['status']=='running' and j.get('resource')==name for j in roots)+(len(_render_leases) if name=='render' else 0),
             'queued':sum(j['status']=='queued' and j.get('resource')==name for j in roots)+(len(_render_waiters) if name=='render' else 0)}
            for name,limit in RESOURCE_LIMITS.items()]}


@contextmanager
def import_render_slot(job_id, stage_id=None):
    """Import keeps its I/O slot and borrows render capacity for one bounded batch.

    Only io -> render is allowed; exports never wait for io, so no lease cycle
    exists. Already queued interactive exports have priority over background previews.
    """
    with _resource_changed:
        root=_jobs[job_id]
        if root.get('parent_id') or root['resource']!='io' or root['kind'] not in ('import','video-import') or job_id not in _running:
            raise ValueError('Only a running import can borrow a render slot')
        if job_id in _render_leases or job_id in _render_waiters:raise ValueError('A render lease cannot be nested')
        child=_jobs.get(stage_id) if stage_id else None
        if child and (child.get('parent_id')!=job_id or child['resource']!='render'):raise ValueError('Invalid import render stage')
        _render_waiters.add(job_id)
        try:
            while True:
                if root.get('cancelled') or root['status']=='interrupted':raise JobCancelled()
                occupied=sum(_jobs[key]['resource']=='render' for key in _running)+len(_render_leases)
                if not _queued['render'] and not _display_order and occupied<RESOURCE_LIMITS['render']:break
                if child and child['status']!='queued':child['status']='queued';persist(stage_id,True)
                _resource_changed.wait(.05)
            _render_leases.add(job_id)
            if child and child['status']!='running':child['status']='running';persist(stage_id,True)
        finally:_render_waiters.discard(job_id)
    try:yield
    finally:
        with _resource_changed:
            _render_leases.discard(job_id);_dispatch('render');_resource_changed.notify_all()


def freeze_for_switch():
    global _accepting
    with _lock:
        if _pending or _display_active or any(j['status'] in ACTIVE for j in _jobs.values()):raise ValueError('请先等待或取消后台任务，再切换图库')
        _accepting=False


def freeze_for_maintenance():
    global _accepting
    with _lock:
        if not _accepting or _pending or _display_active or any(j['status'] in ACTIVE for j in _jobs.values()):raise ValueError('Wait for background tasks before recycling files.')
        _accepting=False


@contextmanager
def display_render_slot(cancelled):
    """Transient, cancellable display demand shares render capacity with exports.

    No history root or billable request is created. Interactive display precedes
    background import borrowing; already queued export roots retain priority.
    """
    token='display-'+str(uuid4())
    with _resource_changed:
        if not _accepting:raise ValueError('正在切换图库，请等待重新打开')
        if _pending+len(_display_active)>=MAX_PENDING:raise ValueError('任务队列已满，请等待或取消待处理任务')
        _display_active.add(token);_display_order.append(token);_render_waiters.add(token)
        try:
            while True:
                if cancelled.is_set():raise JobCancelled()
                occupied=sum(_jobs[key]['resource']=='render' for key in _running)+len(_render_leases)
                if _display_order[0]==token and not _queued['render'] and occupied<RESOURCE_LIMITS['render']:break
                _resource_changed.wait(.03)
            _display_order.remove(token);_render_waiters.discard(token);_render_leases.add(token)
        except BaseException:
            _display_active.discard(token);_render_waiters.discard(token)
            if token in _display_order:_display_order.remove(token)
            _resource_changed.notify_all();raise
    try:yield
    finally:
        with _resource_changed:
            _display_active.discard(token);_render_leases.discard(token);_dispatch('render');_resource_changed.notify_all()


def resume_after_switch_failure():
    global _accepting
    with _lock:_accepting=True

def _dispatch(resource):
    # Called with _lock held. Only occupied slots enter an executor; waiting work
    # stays in our bounded deque, where cancellation can remove it immediately.
    global _pending
    while _queued[resource] and sum(_jobs[key]['resource']==resource for key in _running)+(len(_render_leases) if resource=='render' else 0)<RESOURCE_LIMITS[resource]:
        job_id=_queued[resource].popleft()
        run,executor=_work[job_id]
        _running.add(job_id)
        try:
            (executor or _pools[resource]).submit(run)
        except Exception:
            _running.discard(job_id);_work.pop(job_id,None);_scheduled.discard(job_id);_pending-=1
            _jobs[job_id].update(status='failed',error='任务执行器不可用',finished_at=now())
            persist(job_id,True)

def submit(kind: str, function: Callable, *args, executor=None, resource=None, existing_id=None) -> dict:
    global _pending
    resource=resource or ('cloud' if kind.startswith('watercolor') else 'render' if kind=='export' else 'local-ai' if kind=='faces' else 'network' if kind=='face-models' else 'io')
    if resource not in RESOURCE_LIMITS:raise ValueError('Unknown task resource')
    job_id=existing_id or str(uuid4())
    def run() -> None:
        global _pending
        try:
            with _lock:
                job=_jobs[job_id]
                if job.get('cancelled') or job['status'] in ('cancelled','interrupted'):raise JobCancelled()
                job['status']='running';persist(job_id,True)
            step={'export':'export-render','watercolor':'watercolor-image','watercolor-title':'watercolor-titles',
                  'faces':'faces-analyze','faces-import':'faces-analyze','face-models':'face-model-download'}.get(kind)
            if step:
                with stage(job_id,step) as child_id:function(child_id,*args)
            else:function(job_id,*args)
            check(job_id);update(job_id,status='completed',current='')
        except JobCancelled:
            update(job_id,status='cancelled',current='')
        except Exception as error:
            update(job_id,status='failed',error=str(error))
        finally:
            with _lock:
                _pending-=1;_scheduled.discard(job_id);_running.discard(job_id);_work.pop(job_id,None)
                _dispatch(resource);_trim()
    with _lock:
        if not _accepting:raise ValueError('正在切换图库，请等待重新打开')
        if _pending+len(_display_active)>=MAX_PENDING:raise ValueError('任务队列已满，请等待或取消待处理任务')
        with Session() as session:
            profile=session.get(LibraryProfile,1)
            scope={'library_id':profile.library_id} if profile else {}
        if existing_id:
            old=_jobs.get(existing_id)
            if not old or old.get('actor')!='agent' or old['status']!='awaiting_approval' or old.get('cancelled'):
                raise ValueError('Agent request is no longer awaiting approval.')
            old.update(status='queued',resource=resource)
        else:_jobs[job_id]=dict(id=job_id,kind=kind,status='queued',total=0,processed=0,success=0,skipped=0,
            failed=0,current='',errors=[],results=[],resource=resource,billable=kind.startswith(('watercolor','ai-')),
            billing_state='not_submitted' if kind.startswith(('watercolor','ai-')) else None,child_count=0,scope=scope,resume_policy='manual')
        persist(job_id,True);_pending+=1;_scheduled.add(job_id);_work[job_id]=(run,executor)
        _queued[resource].append(job_id);_dispatch(resource);_trim()
    return get(job_id)


def external(kind, *, billable=False, **details):
    """Visible, durable Agent admission before app approval or renderer work."""
    with _lock:
        if not _accepting:raise ValueError('Library is switching.')
        if sum(j['status'] in ACTIVE and not j.get('parent_id') for j in _jobs.values())>=MAX_PENDING:
            raise ValueError('The task queue is full. Wait for pending work or cancel it.')
        job_id=str(uuid4())
        with Session() as s:
            profile=s.get(LibraryProfile,1)
            scope={'library_id':profile.library_id} if profile else {}
        _jobs[job_id]=dict(id=job_id,kind=kind,status='awaiting_approval',total=0,processed=0,success=0,
            skipped=0,failed=0,current='',errors=[],results=[],resource='agent',billable=billable,
            billing_state='not_submitted' if billable else None,child_count=0,scope=scope,
            actor='agent',resume_policy='manual',**deepcopy(details))
        persist(job_id,True);_trim()
        return deepcopy(_jobs[job_id])


def transition_external(job_id, expected, **values):
    """Compare-and-set prevents two windows from approving or claiming twice."""
    with _lock:
        job=_jobs.get(job_id)
        if not job or job.get('actor')!='agent' or job['status'] not in expected or job.get('cancelled'):
            raise ValueError('Agent request changed. Refresh the task.')
        job.update(deepcopy(values));persist(job_id,True)
        return deepcopy(job)
