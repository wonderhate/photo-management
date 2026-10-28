from ..lut_context import input_comments,validate_context,root_label
"""Read-only external directories; only an explicit use snapshots a CUBE asset."""
import copy,hashlib,os
from itertools import islice
from pathlib import Path
from uuid import uuid4
from threading import RLock
from fastapi import HTTPException
from sqlalchemy import select
from ..config import DATA
from ..models import Session,LutFolder,LutAsset
from ..lut_folders import validate_folders,header,MAX_FOLDERS,MAX_ENTRIES,MAX_DEPTH,valid_path
from ..cube_lut import MAX_CUBE_BYTES,parse_cube,validate_lut_asset

lock=RLock()
def stamp(st):return f'{st.st_dev}:{st.st_ino}:{st.st_size}:{st.st_mtime_ns}'
def linked(path):return path.is_symlink() or getattr(path,'is_junction',lambda:False)()
def list_folders():
    with Session() as s:rows=[copy.deepcopy(r.record) for r in s.scalars(select(LutFolder).order_by(LutFolder.id))]
    validate_folders(rows);return rows
def register(path,folder_id=None):
    target=Path(path).expanduser()
    if not target.is_absolute() or not target.is_dir() or linked(target):raise HTTPException(422,'Choose an available LUT directory.')
    target=target.resolve()
    if target.is_relative_to(DATA.resolve()):raise HTTPException(422,'Choose a directory outside the library.')
    with lock,Session() as s:
        rows=list(s.scalars(select(LutFolder)));row=s.get(LutFolder,folder_id) if folder_id else None
        if folder_id and not row:raise HTTPException(404,'LUT folder not found.')
        duplicate=next((r for r in rows if os.path.normcase(r.path)==os.path.normcase(str(target))),None)
        if duplicate and (not row or row.id!=duplicate.id):
            if row:raise HTTPException(409,'This LUT directory is already linked.')
            return duplicate.record
        if not row and len(rows)>=MAX_FOLDERS:raise HTTPException(422,'Too many LUT folders.')
        record=dict(version=1,id=row.id if row else str(uuid4()),binding=str(uuid4()),name=target.name or str(target),revision=row.record['revision']+1 if row else 0,state='ready',entries=[],truncated=False)
        validate_folders([record])
        if row:row.path=str(target);row.record=record
        else:s.add(LutFolder(id=record['id'],path=str(target),record=record))
        s.commit();return record
def remove(folder_id):
    with lock,Session() as s:
        row=s.get(LutFolder,folder_id)
        if not row:raise HTTPException(404,'LUT folder not found.')
        s.delete(row);s.commit()
def _read(path,root,expected=None):
    if linked(path) or not path.resolve().is_relative_to(root):raise OSError('changed')
    before=path.stat()
    if expected and stamp(before)!=expected:raise OSError('changed')
    if not 0<before.st_size<=MAX_CUBE_BYTES:raise ValueError('size')
    with path.open('rb') as stream:
        if stamp(os.fstat(stream.fileno()))!=stamp(before):raise OSError('changed')
        data=stream.read(MAX_CUBE_BYTES+1)
        if stamp(os.fstat(stream.fileno()))!=stamp(before):raise OSError('changed')
    if len(data)!=before.st_size or stamp(path.stat())!=stamp(before) or linked(path) or not path.resolve().is_relative_to(root):raise OSError('changed')
    return data,stamp(before)
def scan(folder_id):
    with Session() as s:
        row=s.get(LutFolder,folder_id)
        if not row:raise HTTPException(404,'LUT folder not found.')
        before=copy.deepcopy(row.record);root=Path(row.path)
    result=copy.deepcopy(before);old={e['path']:e for e in before['entries']};entries=[];truncated=False
    def walk(directory,depth):
        nonlocal truncated
        if depth>MAX_DEPTH:truncated=True;return
        children=list(islice(directory.iterdir(),20001))
        if len(children)>20000:truncated=True;children=children[:20000]
        for path in sorted(children,key=lambda p:p.name.casefold()):
            if not valid_path(path.relative_to(root).as_posix()):truncated=True;continue
            if path.name.startswith('.') or linked(path) or path.resolve().is_relative_to(DATA.resolve()):continue
            if len(entries)>=MAX_ENTRIES:truncated=True;return
            if path.is_dir():walk(path,depth+1);continue
            if not path.is_file() or path.suffix.lower()!='.cube':continue
            relative=path.relative_to(root).as_posix();current_stamp='';entry=dict(path=relative,stamp='',asset=None,comments=[],error='unreadable')
            try:
                current_stamp=stamp(path.stat());previous=old.get(relative)
                if previous and previous['stamp']==current_stamp and previous['asset']:
                    entries.append(previous);continue
                data,current_stamp=_read(path,root)
                info=header(data[:65536].decode('utf-8-sig',errors='replace'))
                asset=dict(version=1,id=hashlib.sha256(data).hexdigest(),name=path.name,title=info['title'],size=info['size'],bytes=len(data),favorite=False,hidden=False,used_at=None)
                validate_lut_asset(asset)
                entry.update(asset=asset,comments=info['comments'],error=None)
            except ValueError as error:entry['error']='size' if str(error)=='size' else 'header'
            except OSError as error:entry['error']='changed' if str(error)=='changed' else 'unreadable'
            entry['stamp']=current_stamp;entries.append(entry)
    try:
        if linked(root):raise OSError('linked')
        walk(root,0);result.update(state='ready',entries=entries,truncated=truncated)
    except FileNotFoundError:result['state']='missing'
    except PermissionError:result['state']='permission'
    except OSError:result['state']='error'
    validate_folders([result])
    with lock,Session() as s:
        row=s.get(LutFolder,folder_id)
        if not row or row.path!=str(root) or row.record['revision']!=before['revision']:raise HTTPException(409,'LUT folder changed. Refresh the list.')
        if result!=before:result['revision']+=1;row.record=result;s.commit()
        return result
def external_assets():
    return [e['asset'] for f in list_folders() if f['state']=='ready' for e in f['entries'] if e['asset']]
def read_external(asset_id,persist=False):
    # A removed or relocated directory cannot publish a snapshot from an older scan.
    with Session() as s:
        locations=[(r.id,r.path,copy.deepcopy(r.record),e) for r in s.scalars(select(LutFolder)) if r.record['state']=='ready' for e in r.record['entries'] if e['asset'] and e['asset']['id']==asset_id]
    for folder_id,path,record,entry in locations:
        try:data,_=_read(Path(path)/entry['path'],Path(path),entry['stamp'])
        except (OSError,ValueError):continue
        if hashlib.sha256(data).hexdigest()!=asset_id:continue
        if persist:
            try:info=parse_cube(data)
            except ValueError as error:raise HTTPException(422,str(error)) from error
            if info['size']!=entry['asset']['size'] or info['title']!=entry['asset']['title']:raise HTTPException(409,'LUT source changed. Refresh the list.')
        from .lut_service import lock as asset_lock
        with lock,asset_lock,Session() as s:
            row=s.get(LutFolder,folder_id)
            if not row or row.path!=path or row.record['revision']!=record['revision']:raise HTTPException(409,'LUT folder changed. Refresh the list.')
            if persist:
                existing=s.get(LutAsset,asset_id)
                if existing and existing.source!=data:raise HTTPException(409,'LUT source changed. Restore a backup.')
                if not existing:
                    context=dict(groups=[root_label(record['name']),*entry['path'].split('/')[:-1]],comments=input_comments(data.decode('utf-8-sig')[:65536]));validate_context(context)
                    s.add(LutAsset(id=asset_id,metadata_json={**entry['asset'],'version':2,'context':context},source=data));s.commit()
            return data
    raise HTTPException(409,'LUT source changed or unavailable. Refresh or relink its directory.')
def ensure_asset(asset_id):
    with Session() as s:
        if s.get(LutAsset,asset_id):return
    read_external(asset_id,True)

def locate_external(asset_id):
    from ..cube_lut import HASH
    if not HASH.fullmatch(asset_id):raise HTTPException(422,'Invalid LUT data.')
    with lock,Session() as s:
        for row in s.scalars(select(LutFolder)):
            if row.record['state']!='ready':continue
            root=Path(row.path)
            if linked(root):continue
            for entry in row.record['entries']:
                if not entry['asset'] or entry['asset']['id']!=asset_id:continue
                target=root/entry['path']
                try:data,_=_read(target,root,entry['stamp'])
                except (OSError,ValueError):continue
                if hashlib.sha256(data).hexdigest()==asset_id:return target
    raise HTTPException(409,'LUT source changed or unavailable. Refresh or relink its directory.')

def reveal_external(asset_id):
    import subprocess
    path=locate_external(asset_id)
    if os.name!='nt':raise HTTPException(422,'Revealing LUT sources requires Windows.')
    subprocess.Popen(['explorer.exe','/select,',str(path)],creationflags=subprocess.CREATE_NO_WINDOW)
