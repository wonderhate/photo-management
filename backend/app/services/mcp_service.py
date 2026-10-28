"""Session-scoped local Agent access with durable, single-use app approvals."""
import hashlib,json,secrets
from copy import deepcopy
from threading import RLock
from time import monotonic
from sqlalchemy import select
from .. import runtime_control
from ..models import Session,Photo,Album,AlbumPhoto,FacePerson
from ..mcp_schemas import parse,permission
from . import jobs,mcp_tools

lock=RLock()
_token=None
_scopes={'read'}
_requests={}
_selection=None
_selection_version=0
_sessions={}
_rate=[]
MAX_RESPONSE=2*1024*1024

def catalog_id():
    if not runtime_control.library_id:raise ValueError('Library is not ready.')
    return runtime_control.library_id

def state():
    with lock:return dict(enabled=_token is not None,scopes=sorted(_scopes),catalog_id=catalog_id(),
        transport='Streamable HTTP',endpoint='/mcp',restart_disables=True,protocol='2025-06-18')

def configure(enabled,scopes):
    global _token,_scopes
    with lock:
        for id in list(_requests):
            job=jobs.get(id)
            if job and job['status'] in jobs.ACTIVE:
                jobs.cancel(id)
                if job.get('linked_job_id'):jobs.cancel(job['linked_job_id'])
        _requests.clear();_sessions.clear();_rate.clear()
        _token=secrets.token_urlsafe(32) if enabled else None
        _scopes=set(scopes)|{'read'}
        return state()|{'token':_token}

def authenticate(value):
    with lock:
        if not _token or not value or not secrets.compare_digest(value,'Bearer '+_token):return False
        stamp=monotonic();_rate[:]=[t for t in _rate if stamp-t<60]
        if len(_rate)>=120:raise ValueError('MCP rate limit reached. Wait one minute.')
        _rate.append(stamp);return True

def initialize():
    with lock:
        stamp=monotonic()
        for id,value in list(_sessions.items()):
            if stamp-value['seen']>1800:del _sessions[id]
        if len(_sessions)>=8:raise ValueError('Too many MCP sessions.')
        id=secrets.token_urlsafe(24);_sessions[id]=dict(seen=stamp,ready=False)
        return id

def session(id,ready=False):
    with lock:
        value=_sessions.get(id)
        if not value or monotonic()-value['seen']>1800:raise ValueError('MCP session expired. Initialize again.')
        if ready and not value['ready']:raise ValueError('Send notifications/initialized first.')
        value['seen']=monotonic()
        return value

def initialized(id):
    with lock:session(id)['ready']=True

def close_session(id):
    with lock:_sessions.pop(id,None)

def publish(value):
    global _selection,_selection_version
    with lock:
        if value['catalog_id']!=catalog_id():raise ValueError('Catalog changed. Reopen the app.')
        if not value['focused']:
            if _selection and _selection['window_id']==value['window_id']:_selection=None
            return dict(version=_selection_version)
        ids=value['photo_ids'];mcp_tools.photos(ids)
        if len(set(ids))!=len(ids) or value['total_count']<len(ids):raise ValueError('Invalid app selection.')
        next_value={k:value[k] for k in ('catalog_id','window_id','photo_ids','view','total_count')}
        if _selection is None or any(_selection.get(k)!=v for k,v in next_value.items()):_selection_version+=1
        _selection=next_value|{'selection_version':_selection_version,'seen':monotonic()}
        return dict(version=_selection_version)

def selection():
    with lock:
        if not _selection or monotonic()-_selection['seen']>15:raise ValueError('No fresh focused app selection. Focus the app and retry.')
        return {k:deepcopy(v) for k,v in _selection.items() if k!='seen'}

def scope(a):
    if a.get('catalog_id')!=catalog_id():raise ValueError('Catalog changed. Read get_catalog_info again.')
    if 'selection_version' in a:
        chosen=selection()
        if a['selection_version']!=chosen['selection_version']:raise ValueError('Selection changed. Read get_selection again.')
        if chosen['total_count']!=len(chosen['photo_ids']):raise ValueError('Select at most 100 photos or use explicit photo IDs.')
        if not chosen['photo_ids']:raise ValueError('Select at least one photo in the app.')
        a=a|{'photo_ids':chosen['photo_ids']}
    return a

def snapshot(name,a):
    ids=list(a.get('photo_ids',[]))
    if a.get('photo_id'):ids=list(dict.fromkeys(ids+[a['photo_id']]))
    if name=='delete_assets' and a['scope']=='capture':
        with Session() as s:
            groups=select(Photo.capture_group_id).where(Photo.id.in_(ids))
            ids=list(s.scalars(select(Photo.id).where(Photo.capture_group_id.in_(groups)).limit(1001)))
        if len(ids)>1000:raise ValueError('Capture scope is too large. Select fewer photos.')
    result={'photos':mcp_tools.photos(ids) if ids else []}
    if a.get('collection_id'):
        with Session() as s:
            row=s.get(Album,a['collection_id'])
            if not row:raise ValueError('Collection no longer exists.')
            members=list(s.execute(select(AlbumPhoto.photo_id,AlbumPhoto.position).where(AlbumPhoto.album_id==row.id).order_by(AlbumPhoto.photo_id)))
            result['collection']=dict(id=row.id,name=row.name,type=row.type,query=row.query,members=[list(m) for m in members])
    if a.get('person_id'):
        with Session() as s:
            row=s.get(FacePerson,a['person_id'])
            if not row:raise ValueError('Person no longer exists.')
            result['person']=dict(id=row.id,name=row.name)
    if a.get('profile_id'):
        from .ai_studio import profile_snapshot
        profile,_=profile_snapshot(a['profile_id'],a['profile_revision'])
        result['profile']={k:profile[k] for k in ('id','name','provider','region','revision','image_model','vision_model')}
    if name=='render_collage':
        from .collage_service import detail
        project=detail(a['project_id'])
        if project['revision']!=a['revision']:raise ValueError('Collage changed. Review the request again.')
        result['project']=dict(id=project['id'],revision=project['revision'],name=project['name'])
    return result

def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()

def expire():
    stamp=monotonic()
    for id,entry in list(_requests.items()):
        job=jobs.get(id)
        if not job or job['status'] not in jobs.ACTIVE:
            _requests.pop(id,None);continue
        if entry.get('claim') and stamp-entry.get('heartbeat',0)>30:
            jobs.cancel(id);jobs.update(id,status='interrupted',error='App renderer disconnected. Completed outputs are retained; no automatic retry.')
            _requests.pop(id,None)
        elif not entry.get('claim') and job['status'] in ('awaiting_approval','awaiting_app','paused') and stamp>entry['expires']:
            jobs.update(id,status='cancelled',cancelled=True,error='Agent request expired. Submit a new request for review.')
            _requests.pop(id,None)

def call(name,arguments):
    with lock:
        expire()
        if not _token:raise ValueError('MCP is disabled.')
        try:a=parse(name,arguments)
        except Exception:
            job=jobs.external('agent-request',tool=name[:80] if isinstance(name,str) else 'invalid')
            jobs.update(job['id'],status='failed',error='Invalid MCP tool arguments.')
            return dict(job_id=job['id'],isError=True,error='Invalid MCP tool arguments. Inspect tools/list.')
        access=permission(name,a)
        job=jobs.external('agent-request',billable=access=='paid',tool=name,arguments=a,permission=access)
        id=job['id']
        try:
            if access not in _scopes:raise ValueError('This MCP scope is disabled in app settings.')
            if name!='get_catalog_info':a=scope(a)
            jobs.update(id,arguments=a)
            if access=='read':
                jobs.transition_external(id,('awaiting_approval',),status='running')
                result=mcp_tools.read(name,a)
                if len(json.dumps(result,ensure_ascii=False).encode())>MAX_RESPONSE:raise ValueError('Result too large. Narrow the query.')
                audit={k:v for k,v in result.items() if k!='content'} if isinstance(result,dict) else result
                jobs.check(id);jobs.update(id,status='completed',processed=1,total=1,success=1,agent_result=audit)
                return dict(job_id=id,result=result)
            frozen=snapshot(name,a)
            review={'tool':name,'arguments':a,'snapshot':frozen,'permission':access,'catalog_id':catalog_id()}
            fingerprint=digest(review)
            _requests[id]=dict(review=review,digest=fingerprint,expires=monotonic()+600,session=runtime_control.session_id)
            jobs.update(id,review_digest=fingerprint,review=review)
            return dict(job_id=id,status='awaiting_approval',expires_seconds=600,review=mcp_tools.public(review),
                message='Review and approve this concrete request inside PhotoCollection. Tool calls cannot approve it.')
        except Exception:
            jobs.update(id,status='failed',error='Agent request failed. Check the scope and service availability in the app.')
            raise

def inbox():
    with lock:
        expire()
        return dict(enabled=_token is not None,items=[dict(id=id,status=jobs.get(id)['status'],digest=e['digest'],
            expires_seconds=max(0,int(e['expires']-monotonic())),review=e['review']) for id,e in _requests.items()
            if jobs.get(id)['status'] in ('awaiting_approval','awaiting_app','paused')][:64])

def approve(id,fingerprint,approved,paid):
    with lock:
        expire();entry=_requests.get(id)
        if not _token or not entry or entry['digest']!=fingerprint or entry['session']!=runtime_control.session_id:raise ValueError('Agent request expired or changed. Refresh the task.')
        job=jobs.get(id)
        if not job or job['status']!='awaiting_approval':raise ValueError('Agent request is no longer awaiting approval.')
        if not approved:
            jobs.cancel(id);_requests.pop(id,None);return jobs.get(id)
        review=entry['review'];name=review['tool'];a=review['arguments'];access=review['permission']
        if access not in _scopes or review['catalog_id']!=catalog_id():raise ValueError('MCP scope or catalog changed.')
        if access=='paid' and not paid:raise ValueError('Explicit photo upload and billing consent is required.')
        if 'selection_version' in a:scope(a)
        if snapshot(name,a)!=review['snapshot']:raise ValueError('Photos, collection or AI profile changed. Reject this request and review a new one.')
        jobs.check(id)
        if name in mcp_tools.APP_TOOLS:
            return jobs.transition_external(id,('awaiting_approval',),status='awaiting_app',approved=True,paid_consent=paid)
        return jobs.submit('agent-request',run,name,deepcopy(a),deepcopy(review['snapshot']),resource='agent',existing_id=id)

def run(id,name,a,frozen):
    runtime_control.enter_mutation()
    try:
        jobs.check(id)
        if a['catalog_id']!=catalog_id() or snapshot(name,a)!=frozen:raise ValueError('Agent scope changed before execution.')
        result=mcp_tools.execute(id,name,a)
        jobs.check(id);jobs.update(id,agent_result=mcp_tools.public(result))
    finally:runtime_control.leave_mutation()

def claim(id,window_id):
    with lock:
        expire();entry=_requests.get(id);chosen=selection()
        if not _token or not entry or entry.get('claim') or chosen['window_id']!=window_id:raise ValueError('App command is unavailable.')
        if any(e.get('claim') for e in _requests.values()):raise ValueError('Another Agent app render is running. Wait for it to finish.')
        review=entry['review']
        if snapshot(review['tool'],review['arguments'])!=review['snapshot']:raise ValueError('App command source changed.')
        value=jobs.transition_external(id,('awaiting_app',),status='running',resource='render')
        entry.update(claim=secrets.token_urlsafe(32),window_id=window_id,heartbeat=monotonic())
        return dict(id=value['id'],claim_token=entry['claim'],review=review)

def progress(id,token,processed,total):
    with lock:
        expire();entry=_requests.get(id)
        if not entry or not secrets.compare_digest(entry.get('claim',''),token):raise ValueError('App command lease expired.')
        if jobs.get(id).get('cancelled'):return {'cancelled':True}
        jobs.check(id);entry['heartbeat']=monotonic()
        jobs.update(id,processed=processed,total=total)
        return {'cancelled':False}

def finish(id,token,result,error):
    with lock:
        entry=_requests.get(id)
        if not entry or not secrets.compare_digest(entry.get('claim',''),token):raise ValueError('App command lease expired.')
        job=jobs.get(id)
        if job['status']!='running':raise ValueError('App command is no longer running.')
        status='cancelled' if job.get('cancelled') else 'failed' if error else 'completed'
        jobs.update(id,status=status,agent_result=result,results=result.get('exports',[]),error=error,
            success=len(result.get('documents',[]))+len(result.get('exports',[])) if not error else 0)
        _requests.pop(id,None);return jobs.get(id)

def control(action,id,caller):
    if id==caller:raise ValueError('A control request cannot control itself.')
    with lock:
        job=jobs.get(id)
        if not job:raise ValueError('Task not found.')
        if action=='cancel_job':
            result=jobs.cancel(id)
            if job.get('linked_job_id'):jobs.cancel(job['linked_job_id'])
            return result
        entry=_requests.get(id)
        if not entry or entry.get('claim'):raise ValueError('Only unclaimed Agent requests can pause or resume. Running work can be cancelled.')
        if action=='pause_job':
            if job['status'] not in ('awaiting_approval','awaiting_app'):raise ValueError('Task cannot be paused.')
            entry['previous']=job['status']
            return jobs.transition_external(id,('awaiting_approval','awaiting_app'),status='paused')
        return jobs.transition_external(id,('paused',),status=entry.get('previous','awaiting_approval'))
