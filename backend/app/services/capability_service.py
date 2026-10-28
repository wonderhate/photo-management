"""Read-only capability facts. Never load models, request permissions or probe billing."""
import importlib.util
import os
from ...version import VERSION
from .embedding_service import service as semantic
from . import face_service, art_credentials
from ..config import settings


def detected(module):
    try:
        return importlib.util.find_spec(module) is not None
    except (ImportError, ValueError, AttributeError):
        return False


def capability(state, reason, runnable, *, execution='local', actions=(), **facts):
    return dict(state=state, reason=reason, runnable=runnable, execution=execution,
                actions=list(actions), facts=facts)


def semantic_capability():
    # Avoid status().cached_bytes: recursively walking model weights on each UI read is unnecessary.
    semantic.refresh_task_state()
    with semantic.lock:
        semantic_state=semantic.state.get('status','not_loaded')
        loaded=semantic.model is not None
        model=semantic.model_name
    dependency=detected('torch') and detected('transformers')
    if loaded and semantic_state in ('ready','indexing'):
        search=capability('available','ready',True,engine='loaded',model=model)
    elif not dependency:
        search=capability('unavailable','dependency_missing',False,actions=('semantic-settings',),engine='missing',model=model)
    else:
        reason='model_loading' if semantic_state in ('loading','indexing') else 'model_error' if semantic_state=='error' else 'model_not_loaded'
        search=capability('degraded',reason,False,actions=('semantic-settings',),engine='detected',model=model)
    return search


def face_capability():
    faces=face_service.status()
    face_ready=face_service._engines is not None
    recognition=capability('available' if faces['available'] and face_ready else 'degraded' if faces['dependency'] else 'unavailable',
        'dependency_missing' if not faces['dependency'] else 'ready' if faces['available'] and face_ready else 'weights_not_loaded' if faces['cached'] else 'weights_missing',
        faces['available'],actions=('faces',),engine='loaded' if face_ready else 'detected' if faces['dependency'] else 'missing',
        weights='cached' if faces['cached'] else 'missing',model=faces['model'])
    return recognition


def cloud_capabilities():
    credentials=art_credentials.status()
    configured=credentials['configured']
    cloud_reason='cloud_not_checked' if configured else 'credential_error' if credentials['key_error'] else 'credential_missing'
    config=settings()
    def cloud(model):
        return capability('degraded' if configured else 'unavailable',cloud_reason,configured,
            execution='cloud',actions=('watercolor',),model=model,connection='not_checked',consent_required=True)
    return {'watercolor':cloud(config['art_image_model']),'titles':cloud(config['art_title_model']),
            'batchWatercolor':cloud(config['art_image_model'])}


def snapshot():
    picker=detected('tkinter') or detected('PyQt6')
    interactive=os.name=='nt' or bool(os.environ.get('DISPLAY') or os.environ.get('WAYLAND_DISPLAY'))
    picker_state=capability('degraded' if picker and interactive else 'unavailable',
        'picker_not_checked' if picker and interactive else 'picker_unavailable',picker and interactive,
        execution='native',actions=('manual-paths',),engine='detected' if picker else 'missing')
    items={
        'library':capability('available','ready',True,engine='sqlite'),
        'watermark':capability('available','ready',True,engine='pillow-v1'),
        'filePicker':picker_state,'directoryPicker':dict(picker_state),
    }
    for name,reader,action in [('semantic',semantic_capability,'semantic-settings'),('faces',face_capability,'faces')]:
        try:
            items[name]=reader()
        except Exception:
            # Status failures must not hide the other engines or expose local exception paths.
            items[name]=capability('unavailable','status_unavailable',False,actions=(action,))
    try:
        items.update(cloud_capabilities())
    except Exception:
        for name in ('watercolor','titles','batchWatercolor'):
            items[name]=capability('unavailable','status_unavailable',False,execution='cloud',actions=('watercolor',))
    return dict(version=1,runtime='native',application_version=VERSION,items=items)
