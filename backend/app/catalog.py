"""Select existing libraries without copying them; apply selections before engine creation."""
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4
import re
import sqlite3
from . import storage
from .migrations import SCHEMA_VERSION

HISTORY_LIMIT = 20


def path_value(value: str) -> Path:
    path=Path(value.strip()).expanduser()
    if not value.strip() or not path.is_absolute():
        raise ValueError('请填写完整的绝对目录路径')
    return path.resolve()


def inspect(value: str) -> dict:
    path=path_value(value);database=path/'library.db'
    if not path.is_dir() or not database.is_file():
        raise ValueError('请选择包含 library.db 的光影集图库目录')
    try:
        with closing(sqlite3.connect(database.as_uri()+'?mode=ro',uri=True,timeout=3)) as connection:
            connection.execute('PRAGMA query_only=ON')
            version=connection.execute('PRAGMA user_version').fetchone()[0]
            if version>SCHEMA_VERSION:
                raise ValueError('照片库版本较新，请使用支持该版本的程序')
            tables={row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if not {'photos','capture_groups','albums'}.issubset(tables):
                raise ValueError('请选择包含 library.db 的光影集图库目录')
            columns={row[1] for row in connection.execute('PRAGMA table_info(photos)')}
            if not {'id','file_path','file_hash'}.issubset(columns):
                raise ValueError('请选择包含 library.db 的光影集图库目录')
            identity=connection.execute('SELECT library_id FROM library_profile WHERE singleton=1').fetchone() if 'library_profile' in tables else None
            library_id=identity[0] if identity else None
            if library_id is not None and (not isinstance(library_id,str) or not re.fullmatch(r'[a-zA-Z0-9-]{1,80}',library_id)):
                raise ValueError('图库身份无效，请从备份恢复')
            count=connection.execute('SELECT count(*) FROM photos').fetchone()[0]
    except sqlite3.Error as error:
        raise ValueError('无法读取所选图库，请检查数据库是否损坏或正被锁定') from error
    stat=database.stat()
    return dict(path=str(path),name=path.name,library_id=library_id,photo_count=count,schema_version=version,
                file_id=f'{stat.st_dev}:{stat.st_ino}')


def history(config: dict) -> list[dict]:
    result=[];seen=set()
    for item in config.get('recent_catalogs',[]):
        if not isinstance(item,dict) or not isinstance(item.get('path'),str) or item['path'] in seen:
            continue
        seen.add(item['path']);result.append(item)
        if len(result)==HISTORY_LIMIT:break
    return result


def public_info(value: dict | None):
    if value is None:return None
    return {key:value[key] for key in ('path','name','library_id','photo_count','schema_version','selected_at','selection_id') if key in value}


def entry(info: dict, paths: dict, previous_exports=()) -> dict:
    return info | {'exports_dir':paths['exports_dir'],'scan_paths':list(paths['scan_paths']),
                   'previous_exports_dirs':list(previous_exports),'selected_at':datetime.now(timezone.utc).isoformat()}


def create_empty(path: Path, initializer) -> dict:
    if path.exists() and (not path.is_dir() or any(path.iterdir())):
        raise ValueError('新图库必须是空目录，不会覆盖已有文件')
    path.parent.mkdir(parents=True,exist_ok=True)
    # Build under our own staging directory, never initialize a user's occupied folder.
    with TemporaryDirectory(prefix='.photocollection-new-',dir=path.parent) as temporary:
        stage=Path(temporary)
        initializer(stage)
        inspect(str(stage))
        # rmdir only accepts an empty directory; a concurrent file prevents publication.
        if path.exists():path.rmdir()
        stage.rename(path)
    return inspect(str(path))


def select(config_path: Path, current: dict, target: str, locked=(), *, create=False, initializer=None, fallback=None) -> dict:
    if 'data_dir' in locked:
        raise ValueError('图库由启动配置指定，不能在此切换')
    path=path_value(target);source=Path(current['data_dir']).resolve()
    if path!=source and (path in source.parents or source in path.parents):
        raise ValueError('所选图库不能与当前图库互相包含')
    with storage.lock:
        config=storage.read_config(config_path,fallback)
        if config.get('pending_paths'):
            raise ValueError('请先取消待生效的目录迁移，再选择图库')
        if path==source:
            config.pop('pending_catalog',None);storage.write_config(config_path,config);return config
        current_info=inspect(str(source))
        if create:
            for scan in current['scan_paths']:
                scan_path=Path(scan).resolve()
                if path==scan_path or scan_path in path.parents:
                    raise ValueError('请在原片扫描目录之外新建图库')
            if initializer is None:raise ValueError('图库初始化不可用')
            info=create_empty(path,initializer)
        else:info=inspect(str(path))
        recent=history(config)
        prior=next((item for item in recent if item['path']==str(path) and item.get('library_id')==info['library_id']),None)
        destination={'exports_dir':str(path/'exports'),'scan_paths':[]}
        if prior:destination.update({key:prior[key] for key in ('exports_dir','scan_paths') if key in prior})
        if 'exports_dir' in locked:destination['exports_dir']=current['exports_dir']
        pending=entry(info,destination,prior.get('previous_exports_dirs',[]) if prior else [])
        pending['selection_id']=str(uuid4())
        remembered=entry(current_info,current,config.get('previous_exports_dirs',[]))
        config.update(current)
        config['recent_catalogs']=[remembered]+[item for item in recent if item['path']!=str(source)]
        config['recent_catalogs']=config['recent_catalogs'][:HISTORY_LIMIT]
        config['pending_catalog']=pending
        storage.write_config(config_path,config)
        return config


def validate_pending(config: dict, locked=(), selection_id=None) -> dict:
    if 'data_dir' in locked:raise ValueError('图库由启动配置指定，不能在此切换')
    if config.get('pending_paths'):raise ValueError('请先取消待生效的目录迁移，再选择图库')
    pending=config.get('pending_catalog')
    if not pending or selection_id is not None and pending.get('selection_id')!=selection_id:
        raise ValueError('待切换图库已改变，请刷新后重新选择')
    actual=inspect(pending['path'])
    identity=pending.get('library_id')
    if identity is not None and identity!=actual['library_id'] or identity is None and pending.get('file_id')!=actual['file_id']:
        raise ValueError('所选目录中的图库已被替换，请重新选择')
    return pending | actual


def apply_pending(config_path: Path, config: dict, locked=()) -> tuple[dict,str | None]:
    if not config.get('pending_catalog'):return config,None
    try:
        pending=validate_pending(config,locked)
        updated=config | {'data_dir':pending['path'],'exports_dir':pending['exports_dir'],
                          'scan_paths':pending['scan_paths'],'previous_exports_dirs':pending['previous_exports_dirs']}
        recent=history(config)
        updated['recent_catalogs']=[pending]+[item for item in recent if item['path']!=pending['path']]
        updated['recent_catalogs']=updated['recent_catalogs'][:HISTORY_LIMIT]
        updated.pop('pending_catalog',None)
        storage.write_config(config_path,updated)
        return updated,None
    except (OSError,ValueError,KeyError,TypeError) as error:
        return config,f'图库切换未生效，继续使用原图库：{error}'
