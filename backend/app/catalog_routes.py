from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import create_engine
from . import config, catalog, storage, runtime_control
from .models import initialize, Session, LibraryProfile
from .services import jobs

router=APIRouter(prefix='/api/workspace/catalogs',tags=['workspace'])


class Identity(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True)
    library_id: str=Field(min_length=1,max_length=80,pattern=r'^[a-zA-Z0-9-]+$')


class Selection(Identity):
    path: str=Field(min_length=1,max_length=4096)
    create: bool=False


class Activation(Identity):
    selection_id: str=Field(min_length=1,max_length=80,pattern=r'^[a-zA-Z0-9-]+$')


def ensure_identity(expected):
    with Session() as session:
        profile=session.get(LibraryProfile,1)
        if not profile or profile.library_id!=expected:raise HTTPException(409,'图库已切换，请重新打开当前图库')


def settings_config():return storage.read_config(config.LOCAL_CONFIG_FILE,config.LEGACY_CONFIG_FILE)


def initialize_empty(path: Path):
    engine=create_engine(f'sqlite:///{path/"library.db"}')
    try:initialize(engine)
    finally:engine.dispose()


@router.get('')
def status():
    value=settings_config()
    return {'current':catalog.public_info(catalog.inspect(str(config.DATA))),
            'recent':[catalog.public_info(item) for item in catalog.history(value)],
            'pending':catalog.public_info(value.get('pending_catalog')),
            'locked':'data_dir' in config.LOCKED_STORAGE,'migration_pending':bool(value.get('pending_paths')),
            'error':config.CATALOG_ERROR,**runtime_control.snapshot()}


@router.post('/inspect')
def preview(payload: Selection):
    ensure_identity(payload.library_id)
    return catalog.public_info(catalog.inspect(payload.path))


@router.post('/select')
def select(payload: Selection):
    ensure_identity(payload.library_id)
    if jobs.resources()['pending']:raise HTTPException(409,'请先等待或取消后台任务，再选择其他图库')
    try:
        catalog.select(config.LOCAL_CONFIG_FILE,config.storage_paths()['current'],payload.path,config.LOCKED_STORAGE,
                       create=payload.create,initializer=initialize_empty,fallback=config.LEGACY_CONFIG_FILE)
    except OSError as error:
        raise HTTPException(400,'无法保存图库选择，请检查目录权限或可用空间') from error
    config.CATALOG_ERROR=None
    return status()


@router.post('/cancel')
def cancel(payload: Identity):
    ensure_identity(payload.library_id)
    with storage.lock:
        value=settings_config();value.pop('pending_catalog',None);storage.write_config(config.LOCAL_CONFIG_FILE,value)
    config.CATALOG_ERROR=None
    return status()


@router.post('/activate')
def activate(payload: Activation):
    ensure_identity(payload.library_id)
    # Middleware has already closed admission to other mutations for this request.
    try:
        with storage.lock:catalog.validate_pending(settings_config(),config.LOCKED_STORAGE,payload.selection_id)
        jobs.freeze_for_switch()
        runtime_control.request_restart()
    except Exception:
        jobs.resume_after_switch_failure()
        raise
    return {'restarting':True}
