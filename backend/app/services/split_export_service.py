"""Copy immutable split assets, never render again or overwrite a destination."""
import hashlib
import json
import os
from pathlib import Path
from urllib.parse import unquote
from fastapi import HTTPException
from ..config import DATA, EXPORTS
from ..models import Session
from ..split_schemas import SplitExport
from . import editor_service as editor, split_service, export_registry


def _stem(name):
    name=Path(name).stem
    for ending in ('_split-master','-master'):
        if name.endswith(ending):name=name[:-len(ending)];break
    return editor.clean_name(name,100)


def _identity(path):
    value=path.stat(follow_symlinks=False)
    return value.st_dev,value.st_ino


def _source_prefix(path,source):
    # A failed copy can leave a prefix, while an external editor can change a
    # file without changing its inode. Keep anything we cannot attribute to
    # the copy, even though that means leaving a visibly interrupted export.
    try:
        if path.stat().st_size>source.stat().st_size:return False
        with path.open('rb') as actual,source.open('rb') as expected:
            while chunk:=actual.read(1024*1024):
                if chunk!=expected.read(len(chunk)):return False
        return True
    except OSError:return False


def _remove_owned(path,identity,source=None):
    try:
        if _identity(path)==identity and (path.stat().st_size==0 or source is not None and _source_prefix(path,source)):path.unlink()
    except FileNotFoundError:pass


def _copy(source,stream,expected_hash):
    digest=hashlib.sha256()
    with source.open('rb') as original:
        while chunk:=original.read(1024*1024):
            stream.write(chunk);digest.update(chunk)
    if digest.hexdigest()!=expected_hash:raise HTTPException(409,'Split group is incomplete or damaged.')
    stream.flush();os.fsync(stream.fileno())


def export_group(group_id: str,payload: SplitExport):
    root=Path(payload.output_directory) if payload.output_directory else EXPORTS
    if not root.is_absolute():raise HTTPException(422,'Export directory must be an absolute path.')
    if not payload.output_directory:root.mkdir(parents=True,exist_ok=True)
    root=root.resolve()
    if not root.is_dir():raise HTTPException(422,'Export directory is unavailable. Choose it again.')
    signature={'group_id':group_id,'directory':str(root),'subfolder':payload.subfolder}
    receipts=DATA/'export-records'/'splits';receipt=receipts/(str(payload.request_id)+'.json')
    with editor.lock,Session() as session:
        master=editor.get_variant(session,group_id);group=split_service.group_json(session,master);meta=split_service.lineage(master)
        if receipt.exists():
            try:
                saved=json.loads(receipt.read_text('utf-8'))
                if saved['version']!=1 or saved['request']!=signature:raise ValueError()
                result=saved['result']
                for item in result['files']:
                    target=export_registry.lookup(unquote(item['url'].rsplit('/',1)[-1]))
                    if target is None or editor.file_hash(target)!=item['sha256']:raise ValueError()
                if [p['sha256'] for p in result['files']]!=meta.panel_hashes:raise ValueError()
                return result
            except (OSError,KeyError,TypeError,ValueError) as error:
                raise HTTPException(409,'Export receipt changed or files are missing. Start a new export.') from error
        sources=[editor.variant_path(editor.get_variant(session,p['id'])) for p in group['panels']]
        stem=_stem(master.name);owned=[];streams=[];folder=None;folder_identity=None;records=[];success=False;receipt_owned=False
        try:
            # Reserve the entire set using exclusive file creation. Any collision
            # restarts the whole numbered set, without truncating a single file.
            for number in range(10000):
                prefix=stem+'_split'+('_'+str(number) if number else '')
                if payload.subfolder:
                    folder=root/prefix
                    try:folder.mkdir()
                    except FileExistsError:continue
                    folder_identity=_identity(folder)
                else:folder=root
                names=[f'{stem}_split_{i+1:02d}.{meta.format}' if payload.subfolder else f'{prefix}_{i+1:02d}.{meta.format}' for i in range(len(sources))]
                try:
                    for name in names:
                        target=folder/name;stream=target.open('xb');streams.append(stream);owned.append((target,_identity(target)))
                    break
                except FileExistsError:
                    for stream in streams:stream.close()
                    streams.clear()
                    for path,identity in owned:_remove_owned(path,identity)
                    owned.clear()
                    if payload.subfolder and _identity(folder)==folder_identity:folder.rmdir()
                    folder_identity=None
            else:raise HTTPException(409,'Too many export name collisions. Choose another directory.')
            for source,stream,expected in zip(sources,streams,meta.panel_hashes):_copy(source,stream,expected)
            for stream in streams:stream.close()
            streams.clear()
            # Check the whole set again before registering any downloads.
            for (path,identity),expected in zip(owned,meta.panel_hashes):
                if _identity(path)!=identity or editor.file_hash(path)!=expected:raise HTTPException(409,'Export files changed before completion. Try again.')
            files=[]
            for (path,_),expected in zip(owned,meta.panel_hashes):
                custom=path.resolve().parent!=EXPORTS.resolve()
                filename=(hashlib.sha256(str(path.resolve()).encode('utf-8')).hexdigest()+'__'+path.name) if custom else path.name
                record=export_registry.record_path(filename);records.append((record,record.read_bytes() if record.exists() else None))
                url=export_registry.register(path);files.append({'file_name':path.name,'sha256':expected,'url':url})
            result={'directory':str(folder),'files':files}
            receipts.mkdir(parents=True,exist_ok=True)
            with receipt.open('x',encoding='utf-8') as output:
                receipt_owned=True
                json.dump({'version':1,'request':signature,'result':result},output,ensure_ascii=False);output.flush();os.fsync(output.fileno())
            success=True;return result
        finally:
            for stream in streams:stream.close()
            if not success:
                for record,previous in reversed(records):
                    if previous is None:record.unlink(missing_ok=True)
                    else:record.write_bytes(previous)
                for (path,identity),source in reversed(list(zip(owned,sources))):_remove_owned(path,identity,source)
                if payload.subfolder and folder_identity is not None and folder is not None:
                    try:
                        if _identity(folder)==folder_identity:folder.rmdir()
                    except (FileNotFoundError,OSError):pass
                # A failed receipt write belongs to this request; an existing
                # successful receipt was handled before creating any files.
                if receipt_owned:receipt.unlink(missing_ok=True)
