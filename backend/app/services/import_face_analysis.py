"""Optional local suggestions for a finite set of newly imported records."""
from sqlalchemy import select
from threading import Lock
from ..config import settings, save_settings
from ..models import Session, Photo, CaptureGroup, LibraryProfile
from . import jobs

_policy_lock=Lock()
_revision=0


def enabled():
    return settings().get('auto_face_analysis') is True


def permission():
    with _policy_lock:return _revision if enabled() else None


def policy():
    from . import face_service
    state=face_service.try_status()
    if state is None:return {'enabled':enabled(),'available':False,'reason':'busy'}
    return {'enabled':enabled(),'available':state['available'],
            'reason':'ready' if state['available'] else 'dependency_missing' if not state['dependency'] else 'models_unavailable'}


def set_policy(value):
    global _revision
    with _policy_lock:
        changed=enabled()!=value
        save_settings({'auto_face_analysis':value})
        if changed:_revision+=1
    if not value:
        for job in jobs.recent():
            if job['kind']=='faces-import' and job['status'] in jobs.ACTIVE:jobs.cancel(job['id'])
    return policy()


def queue_after_import(import_id, ids, opted_in):
    if opted_in is None:return
    jobs.check(import_id)
    ids=tuple(dict.fromkeys(ids))
    permitted=permission()==opted_in
    result={'status':'disabled' if not permitted else 'no_new_photos','new_count':len(ids)}
    if permitted and ids:
        try:
            from . import face_service
            state=face_service.try_status()
            if state is not None and not state['available']:result['status']='models_unavailable'
            else:
                task=jobs.submit('faces-import',analyze,ids,import_id,opted_in,resource='local-ai')
                result.update(status='scheduled',job_id=task['id'])
        except jobs.JobCancelled:raise
        except Exception:
            # An optional queue/model failure must not turn a completed import
            # into a failed import or schedule a model download/retry.
            result['status']='unavailable'
    jobs.update(import_id,auto_face_analysis=result)


def analyze(job_id, ids, import_id, opted_in):
    from . import face_service
    if not ids:raise ValueError('Invalid automatic face analysis scope.')
    source=jobs.get(import_id)
    scope=(source or {}).get('scope',{})
    if not scope.get('library_id'):raise ValueError('Invalid automatic face analysis scope.')
    def check():
        jobs.check(job_id)
        if permission()!=opted_in or (jobs.get(import_id) or {}).get('cancelled'):raise jobs.JobCancelled()
        with Session() as session:
            profile=session.get(LibraryProfile,1)
            if not profile or profile.library_id!=scope['library_id']:raise jobs.JobCancelled()
    check()
    available=face_service.is_available();check()
    if not available:raise ValueError('本地人脸模型未就绪；照片已导入，可稍后手动分析。')
    jobs.update(job_id,total=len(ids));counts=dict(success=0,skipped=0,failed=0);errors=[]
    # Do not pass [] to the manual analyzer: that deliberately means all photos.
    # A newly registered RAW that is not the preferred file is skipped, rather
    # than substituting an older JPEG outside this import's exact ID set.
    for index,photo_id in enumerate(ids,1):
        check();jobs.update(job_id,current=photo_id)
        with Session() as session:
            target=session.scalar(select(Photo.id).join(CaptureGroup,CaptureGroup.preferred_photo_id==Photo.id).where(Photo.id==photo_id))
        try:
            if target is None:counts['skipped']+=1
            else:
                result=face_service.detect_photo(target,check=check)
                counts['skipped' if result['cached'] else 'success']+=1
        except jobs.JobCancelled:raise
        except Exception as error:
            counts['failed']+=1;errors.append(f'{photo_id}: {error}')
        jobs.update(job_id,processed=index,errors=errors[-100:],**counts)
