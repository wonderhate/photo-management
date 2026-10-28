"""Reversible quarantine of known generated works and previews.

Never traverses originals, imports, exports, edit sources, or arbitrary paths.
The write-ahead journal survives any interruption between individual renames.
"""
import json
import os
import re
import errno
import shutil
from contextlib import contextmanager
from pathlib import Path
from uuid import UUID,uuid4
from sqlalchemy import select,text
from ..config import DATA
from ..models import Session,Photo,Artwork,WatermarkDraft,RegisteredRawSource,MediaAsset,EditDocument,AssetVariant,CollageOutput,AIResult,now
from .. import runtime_control
from . import jobs,export_registry
from .import_service import file_hash

ERROR='Invalid derived recycle record.'
CHANGED='The selected file changed or is still referenced. Nothing was recycled.'
TOKEN=r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'
ART=re.compile(r'artworks/'+TOKEN+r'/(?:scene\.png|poster-[1-9][0-9]*\.png|preview-[1-9][0-9]*\.webp)')
PREVIEW=re.compile(r'watermark_previews/'+TOKEN+r'-[a-zA-Z0-9_-]+\.webp')
VARIANT=re.compile(r'assets/variants/'+TOKEN+r'/image\.(?:png|jpg|jpeg|webp)')
COLLAGE=re.compile(r'documents/collage-outputs/'+TOKEN+r'/[a-f0-9]{64}\.(?:png|jpg|webp)')
AI_IMAGE=re.compile(r'ai-studio/'+TOKEN+r'/(?:image\.png|generated\.png|preview\.webp)')
PATTERNS=(ART,PREVIEW,VARIANT,COLLAGE,AI_IMAGE)


def safe_path(relative):
    if not isinstance(relative,str) or not any(pattern.fullmatch(relative) for pattern in PATTERNS):raise ValueError(ERROR)
    base=DATA.resolve();target=DATA.joinpath(*relative.split('/'))
    for part in [target,*target.parents]:
        if part==DATA:break
        if part.is_symlink() or getattr(part,'is_junction',lambda:False)():raise ValueError(ERROR)
    if not target.resolve().is_relative_to(base):raise ValueError(ERROR)
    return target


def _key(path):return os.path.normcase(str(Path(path).resolve()))


def protected(session):
    paths=set()
    def keep(value):
        if value:paths.add(_key(value))
    for p in session.execute(select(Photo.file_path,Photo.removed_original_path).execution_options(include_removed=True)):
        keep(p.file_path);keep(p.removed_original_path)
    for path in session.scalars(select(MediaAsset.file_path)):keep(path)
    for path in session.scalars(select(EditDocument.source_path)):keep(path)
    for path in session.scalars(select(AssetVariant.file_path)):keep(path)
    for path in session.scalars(select(CollageOutput.file_path)):keep(path)
    for id in session.scalars(select(AIResult.id).where(AIResult.kind!='annotation')):
        for name in ('image.png','generated.png','preview.webp'):keep(DATA/'ai-studio'/id/name)
    for r in session.scalars(select(RegisteredRawSource.record)):keep(r.get('path'))
    for a in session.execute(select(Artwork.id,Artwork.revision)):
        for name in ('scene.png',f'poster-{a.revision}.png',f'preview-{a.revision}.webp'):keep(DATA/'artworks'/a.id/name)
    for d in session.execute(select(WatermarkDraft.preview_path,WatermarkDraft.artwork_id,WatermarkDraft.source_json)):
        keep(d.preview_path);keep(d.source_json.get('file_path'))
        if d.artwork_id and d.source_json.get('artwork_revision'):
            revision=d.source_json['artwork_revision'];keep(DATA/'artworks'/d.artwork_id/f'poster-{revision}.png')
    paths.update(_key(p) for p in export_registry.registered_files());return paths


def _inventory():
    for folder,pattern in [('artworks','*/*'),('watermark_previews','*'),('assets/variants','*/*'),('documents/collage-outputs','*/*'),('ai-studio','*/*')]:
        for candidate in sorted((DATA/folder).glob(pattern)):
            relative=candidate.relative_to(DATA).as_posix()
            if not any(pattern.fullmatch(relative) for pattern in PATTERNS):continue
            try:
                path=safe_path(relative)
                if path.is_file():yield relative,path
            except (OSError,ValueError):continue


def candidates(page=1):
    if type(page) is not int or page<1:raise ValueError(ERROR)
    with Session() as session:refs=protected(session)
    values=[];total=0
    for relative,path in _inventory():
        if _key(path) in refs:continue
        total+=1
        if (page-1)*40<=total-1<page*40:
            try:values.append(dict(path=relative,sha256=file_hash(path),size=path.stat().st_size))
            except OSError:continue
    return dict(items=values,total=total,page=page,page_size=40)


def _root():
    root=DATA/'recycle'
    if root.is_symlink() or getattr(root,'is_junction',lambda:False)() or not root.resolve().is_relative_to(DATA.resolve()):raise ValueError(ERROR)
    root.mkdir(exist_ok=True);return root


def _folder(id):
    try:
        if str(UUID(id))!=id:raise ValueError()
    except (ValueError,TypeError,AttributeError):raise ValueError(ERROR) from None
    folder=_root()/id
    if folder.is_symlink() or getattr(folder,'is_junction',lambda:False)():raise ValueError(ERROR)
    return folder


def _write(folder,record):
    target=folder/'record.json'
    if target.is_symlink():raise ValueError(ERROR)
    temporary=folder/(str(uuid4())+'.tmp')
    try:
        with temporary.open('x',encoding='utf-8') as stream:
            json.dump(record,stream,ensure_ascii=False);stream.flush();os.fsync(stream.fileno())
        temporary.replace(target)
    finally:temporary.unlink(missing_ok=True)


def _move_no_replace(source,target,expected):
    # Both paths live on the same library volume. Creating a hard link is an
    # atomic no-clobber operation on Windows and POSIX, unlike POSIX rename.
    # FAT/exFAT and filesystems without hard links use an exclusively created,
    # flushed and hash-checked copy. Interrupted copies remain recoverable.
    try:os.link(source,target)
    except OSError as error:
        if target.exists() or error.errno not in (errno.EPERM,errno.EACCES,errno.EXDEV,errno.EINVAL,errno.ENOSYS,errno.ENOTSUP) and getattr(error,'winerror',None) not in (1,17,50):raise
        if os.name=='nt':
            # Windows rename never replaces an occupied destination. FAT/exFAT
            # can therefore publish atomically without an intermediate copy.
            if file_hash(source)!=expected:raise ValueError(CHANGED)
            os.rename(source,target)
            return
        with source.open('rb') as incoming,target.open('xb') as outgoing:
            shutil.copyfileobj(incoming,outgoing,1024*1024);outgoing.flush();os.fsync(outgoing.fileno())
    if file_hash(target)!=expected or file_hash(source)!=expected:raise ValueError('Recycling was interrupted. Restore the recorded batch before retrying.')
    source.unlink()


def _items(items):
    if not isinstance(items,list) or not 1<=len(items)<=100:raise ValueError(ERROR)
    seen=set()
    for item in items:
        if not isinstance(item,dict) or set(item)!={'path','sha256','size'} or not isinstance(item['sha256'],str) or not re.fullmatch('[a-f0-9]{64}',item['sha256']) or type(item['size']) is not int or item['size']<1:raise ValueError(ERROR)
        safe_path(item['path'])
        if item['path'] in seen:raise ValueError(ERROR)
        seen.add(item['path'])
    return items


def _read(id):
    folder=_folder(id);path=folder/'record.json'
    if path.is_symlink() or path.stat().st_size>128*1024:raise ValueError(ERROR)
    value=json.loads(path.read_text('utf-8'))
    if not isinstance(value,dict) or set(value)!={'version','id','created_at','state','items'} or value['version']!=1 or value['id']!=id or value['state'] not in ('moving','stored','restoring','restored') or not isinstance(value['created_at'],str):raise ValueError(ERROR)
    _items(value['items']);return folder,value


def history(page=1):
    if type(page) is not int or page<1:raise ValueError(ERROR)
    rows=[]
    for folder in _root().iterdir():
        if not folder.is_dir():continue
        try:_,record=_read(folder.name)
        except (OSError,ValueError):continue
        rows.append(dict(id=record['id'],created_at=record['created_at'],state=record['state'],count=len(record['items']),bytes=sum(i['size'] for i in record['items'])))
    rows.sort(key=lambda r:(r['created_at'],r['id']),reverse=True)
    return dict(items=rows[(page-1)*20:page*20],total=len(rows),page=page,page_size=20)


@contextmanager
def exclusive():
    with runtime_control.maintenance():
        jobs.freeze_for_maintenance()
        try:yield
        finally:jobs.resume_after_switch_failure()


def recycle(items):
    items=_items(items)
    with exclusive(),Session() as session:
        session.execute(text('BEGIN IMMEDIATE'));refs=protected(session)
        for item in items:
            path=safe_path(item['path'])
            if _key(path) in refs or not path.is_file() or path.stat().st_size!=item['size'] or file_hash(path)!=item['sha256']:raise ValueError(CHANGED)
        id=str(uuid4());folder=_folder(id);folder.mkdir();record=dict(version=1,id=id,created_at=now(),state='moving',items=items);_write(folder,record)
        for index,item in enumerate(items):
            source=safe_path(item['path']);target=folder/f'{index}.bin'
            if target.exists() or file_hash(source)!=item['sha256']:raise ValueError('Recycling was interrupted. Restore the recorded batch before retrying.')
            _move_no_replace(source,target,item['sha256'])
        record['state']='stored';_write(folder,record)
        return dict(id=id,recycled=len(items),originals_untouched=True)


def restore(id):
    with exclusive():
        folder,record=_read(id);moves=[]
        for index,item in enumerate(record['items']):
            source=folder/f'{index}.bin';target=safe_path(item['path'])
            if source.is_symlink():raise ValueError(ERROR)
            if source.exists():
                if target.exists():
                    # A partial quarantine copy never makes a complete original
                    # disappear. Leave its bytes in quarantine for recovery.
                    if file_hash(target)!=item['sha256']:raise ValueError('A recycle restore path is occupied or damaged. No files were restored.')
                else:
                    if file_hash(source)!=item['sha256']:raise ValueError('A recycle restore path is occupied or damaged. No files were restored.')
                    moves.append((source,target,item['sha256']))
            elif not target.is_file() or file_hash(target)!=item['sha256']:raise ValueError('A recycled file is unavailable. Keep the journal and restore a backup.')
        record['state']='restoring';_write(folder,record)
        for source,target,expected in moves:
            target.parent.mkdir(parents=True,exist_ok=True)
            if target.exists():raise ValueError('Restore was interrupted. Existing files were not overwritten; retry from recycle history.')
            _move_no_replace(source,target,expected)
        record['state']='restored';_write(folder,record)
        return dict(restored=len(moves),originals_untouched=True)
