"""Save directory changes now; copy and switch the library before opening it on restart."""
import json
import os
from pathlib import Path
import sqlite3
from tempfile import NamedTemporaryFile, TemporaryDirectory
from threading import Lock
from backend.migrate_storage import migrate

lock = Lock()
FIELDS = ('data_dir','models_dir','exports_dir','scan_paths')


def read_config(path: Path, fallback: Path | None = None) -> dict:
    source = path if path.exists() else fallback
    return json.loads(source.read_text('utf-8-sig')) if source and source.exists() else {}


def write_config(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(mode='w',encoding='utf-8',dir=path.parent,delete=False,suffix='.tmp') as stream:
        temporary = Path(stream.name)
        try:
            json.dump(value,stream,ensure_ascii=False,indent=2)
            stream.flush();os.fsync(stream.fileno())
        except Exception:
            stream.close();temporary.unlink(missing_ok=True);raise
    try: temporary.replace(path)
    finally: temporary.unlink(missing_ok=True)


def directory(value: str, writable: bool = True) -> Path:
    path = Path(value.strip()).expanduser()
    if not value.strip() or not path.is_absolute(): raise ValueError('请填写完整的绝对目录路径')
    path = path.resolve()
    if path.exists() and not path.is_dir(): raise ValueError(f'目录路径指向了文件：{path}')
    if writable:
        parent = path
        while not parent.exists(): parent = parent.parent
        with NamedTemporaryFile(dir=parent): pass
    elif not path.is_dir(): raise ValueError(f'照片扫描目录不存在：{path}')
    return path


def validate_paths(value: dict, current: dict, locked: list[str] = ()) -> dict:
    result = {key:str(directory(value[key])) for key in FIELDS[:3]}
    result['scan_paths'] = list(dict.fromkeys(str(directory(path,False)) for path in value['scan_paths'] if path.strip()))
    for key in locked:
        if result[key] != current[key]: raise ValueError(f'{key} 由启动环境指定，请在启动配置中修改')
    source, target = Path(current['data_dir']).resolve(), Path(result['data_dir'])
    if target != source:
        if source in target.parents or target in source.parents: raise ValueError('新照片库不能与旧库互相包含')
        if target.exists() and any(target.iterdir()): raise ValueError('新照片库必须是空目录，不会覆盖已有文件')
    return result


def save_paths(path: Path, current: dict, value: dict, locked: list[str], fallback: Path | None = None) -> dict:
    with lock:
        requested = validate_paths(value,current,locked)
        config = read_config(path,fallback) | current
        config.pop('pending_paths',None)
        if requested != current: config['pending_paths'] = requested
        write_config(path,config)
        return config


def apply_pending(path: Path, config: dict, locked: list[str]) -> tuple[dict,str | None]:
    if not config.get('pending_paths'): return config,None
    try:
        current = {key:config[key] for key in FIELDS}
        requested = validate_paths(config['pending_paths'],current,locked)
        updated = config | requested
        updated.pop('pending_paths',None)
        if requested['exports_dir'] != current['exports_dir']:
            updated['previous_exports_dirs'] = list(dict.fromkeys(config.get('previous_exports_dirs',[]) + [current['exports_dir']]))
        source, target = Path(current['data_dir']), Path(requested['data_dir'])
        if source != target:
            target.parent.mkdir(parents=True,exist_ok=True)
            with TemporaryDirectory(prefix='.photo-library-copy-',dir=target.parent) as folder:
                stage = Path(folder)
                migrate(source,stage,relocate_to=target)
                # Recheck before publishing; never replace another library or user's files.
                if target.exists(): target.rmdir()
                stage.rename(target)
                try: write_config(path,updated)
                except Exception:
                    target.rename(stage)
                    raise
        else: write_config(path,updated)
        return updated,None
    except (OSError,ValueError,KeyError,sqlite3.Error) as error:
        return config,f'目录修改未生效，继续使用原照片库：{error}'
