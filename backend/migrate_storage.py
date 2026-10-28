"""Copy a library database and its derived files to an explicit destination.

Original photo paths remain unchanged. The source library remains as a fallback.
Run with the application stopped before changing library-config.json.
"""
import argparse
from contextlib import closing
import json
import os
from pathlib import Path
import shutil
import sqlite3
import hashlib
from tempfile import TemporaryDirectory

MANAGED_FOLDERS=('thumbnails','previews','watermark_previews','embeddings','exports','export-records','faces','imports','plugins','backups','artworks','documents','assets','recycle','masks','stickers','media','analysis','ai-studio')


def linked(path):
    return path.is_symlink() or getattr(path,'is_junction',lambda:False)()


def copy_checked(original, target):
    if linked(original) or not original.is_file():
        raise ValueError('Managed library files must not link to external files.')
    before=digest_file(original)
    shutil.copy2(native_path(original),native_path(target))
    if before!=digest_file(target) or before!=digest_file(original):
        raise ValueError('A managed file changed while copying the library.')
    with native_path(target).open('r+b') as stream:
        os.fsync(stream.fileno())


def digest_file(path):
    digest=hashlib.sha256()
    with native_path(path).open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):digest.update(chunk)
    return digest.hexdigest()


def managed_files(folder):
    if linked(folder):raise ValueError('Managed library folders must not link to external files.')
    def failure(error):raise error
    for parent,dirs,names in os.walk(folder,followlinks=False,onerror=failure):
        for name in dirs:
            if linked(Path(parent)/name):raise ValueError('Managed library folders must not link to external files.')
        for name in names:
            path=Path(parent)/name
            if linked(path) or not path.is_file():raise ValueError('Managed library folders must contain regular files.')
            yield path

def native_path(path: Path) -> Path:
    value = str(path.resolve())
    if os.name != 'nt' or value.startswith('\\\\?\\'):
        return Path(value)
    return Path('\\\\?\\UNC\\' + value[2:] if value.startswith('\\\\') else '\\\\?\\' + value)

def _copy_library(source: Path, destination: Path, relocate_to: Path | None = None) -> dict:
    source, destination = source.resolve(strict=True), destination.resolve()
    final = (relocate_to or destination).resolve()
    if source == final or source in final.parents or final in source.parents:
        raise ValueError('新照片库不能与旧库相同或互相包含')
    if not (source/'library.db').is_file():
        raise ValueError('源照片库数据库不存在')
    if linked(source/'library.db'):
        raise ValueError('Managed library files must not link to external files.')
    if destination.exists() and (not destination.is_dir() or any(destination.iterdir())):
        raise ValueError('新照片库必须是空目录，不会覆盖已有文件')
    from backend.library_maintenance import validate_edit_lineage
    from backend.app.migrations import SCHEMA_VERSION
    with closing(sqlite3.connect((source/'library.db').as_uri()+'?mode=ro',uri=True)) as check:
        check.row_factory=sqlite3.Row
        if check.execute('PRAGMA user_version').fetchone()[0]>SCHEMA_VERSION:raise ValueError('照片库版本较新，请使用兼容程序')
        if [tuple(row) for row in check.execute('PRAGMA integrity_check')]!=[('ok',)]:
            raise ValueError('源照片库数据库校验失败')
        validate_edit_lineage(check)
    destination.mkdir(parents=True, exist_ok=True)
    target_db = destination / 'library.db'
    if target_db.exists():
        raise FileExistsError(f'Refusing to overwrite an existing library: {target_db}')
    copied = 0
    for name in MANAGED_FOLDERS:
        folder = source / name
        if linked(folder):raise ValueError('Managed library folders must not link to external files.')
        if not folder.is_dir(): continue
        for original in managed_files(folder):
            target = destination / name / original.relative_to(folder)
            if target.exists():
                raise FileExistsError(f'Refusing to overwrite an existing file: {target}')
            target.parent.mkdir(parents=True, exist_ok=True)
            copy_checked(original,target)
            copied += 1
    for name in ('settings.json', 'art-key.dpapi', 'qwen-art-key.dpapi'):
        if (source/name).exists() or linked(source/name):
            copy_checked(source/name,destination/name)
    def relocate(value, root=source):
        try: return str(final / root.relative_to(source) / Path(value).relative_to(root))
        except (ValueError, TypeError): return value
    with closing(sqlite3.connect((source/'library.db').as_uri()+'?mode=ro',uri=True)) as old, closing(sqlite3.connect(target_db)) as new:
        old.backup(new)
        tables={row[0] for row in new.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        for table, field in [('photos','thumbnail_path'),('photos','preview_path'),('embeddings','embedding_path'),('watermark_drafts','preview_path'),('watermark_drafts','export_path'),('edit_documents','source_path'),('asset_variants','file_path'),('collage_outputs','file_path'),('media_assets','cover_path')]:
            if table not in tables: continue
            rows = new.execute(f'SELECT rowid, {field} FROM {table} WHERE {field} IS NOT NULL').fetchall()
            for row_id, value in rows:
                new.execute(f'UPDATE {table} SET {field}=? WHERE rowid=?', (relocate(value),row_id))
        for table in ('collage_projects','collage_outputs'):
            if table not in tables:continue
            for row_id,value in new.execute(f'SELECT rowid,assets FROM {table}').fetchall():
                assets=json.loads(value)
                for asset in assets.values():asset['path']=relocate(asset['path'])
                new.execute(f'UPDATE {table} SET assets=? WHERE rowid=?',(json.dumps(assets),row_id))
        # Only browser-managed originals are copied; external originals keep their paths.
        for row_id, value in new.execute('SELECT rowid,file_path FROM photos').fetchall():
            updated=relocate(value,source/'imports')
            if updated!=value:
                new.execute('UPDATE photos SET file_path=?,source_directory=? WHERE rowid=?',(updated,str(Path(updated).parent).casefold(),row_id))
        photo_columns={r[1] for r in new.execute('PRAGMA table_info(photos)')}
        if {'removed_at','removed_original_path'}<=photo_columns:
            for row_id,value,removed in new.execute('SELECT rowid,removed_original_path,removed_at FROM photos WHERE removed_at IS NOT NULL').fetchall():
                new.execute('UPDATE photos SET removed_original_path=? WHERE rowid=?',(relocate(value,source/'imports'),row_id))
            for row_id,value in new.execute('SELECT rowid,file_path FROM photos WHERE removed_at IS NOT NULL').fetchall():
                new.execute('UPDATE photos SET file_path=? WHERE rowid=?',(relocate(value,source/'removed-records'),row_id))
        if 'media_assets' in tables:
            for row_id,value in new.execute('SELECT rowid,file_path FROM media_assets').fetchall():
                updated=relocate(value,source/'imports')
                if updated!=value:new.execute('UPDATE media_assets SET file_path=? WHERE rowid=?',(updated,row_id))
        if 'watermark_drafts' in tables:
            for row_id,value in new.execute('SELECT rowid,source_json FROM watermark_drafts').fetchall():
                snapshot=json.loads(value)
                snapshot['file_path']=relocate(snapshot.get('file_path'),source/'imports')
                for namespace in ('assets','artworks'):
                    snapshot['file_path']=relocate(snapshot.get('file_path'),source/namespace)
                new.execute('UPDATE watermark_drafts SET source_json=? WHERE rowid=?',(json.dumps(snapshot,ensure_ascii=False),row_id))
        new.commit()
        photos = new.execute('SELECT COUNT(*) FROM photos').fetchone()[0]
        if new.execute('PRAGMA integrity_check').fetchone()[0]!='ok' or new.execute('PRAGMA foreign_key_check').fetchall():
            raise ValueError('照片库复制后的数据库校验失败')
    for record in (destination/'export-records').glob('*.json'):
        metadata=json.loads(record.read_text('utf-8'))
        previous=metadata['file_path']
        updated=relocate(previous,source/'exports')
        metadata['file_path']=updated
        if metadata.get('custom') and updated!=previous:
            staged=destination/Path(updated).relative_to(final)
            if staged.is_file():
                # Preserve the old path-hashed URL without granting arbitrary
                # file access: the resolver requires a managed export and SHA.
                metadata.setdefault('migration_alias',{'version':1,'previous_path':previous})
                metadata['sha256']=digest_file(staged)
        record.write_text(json.dumps(metadata,ensure_ascii=False),'utf-8')
    for record in (destination/'export-records'/'splits').glob('*.json'):
        receipt=json.loads(record.read_text('utf-8'))
        if receipt.get('version')!=1:raise ValueError('Unsupported split export receipt version.')
        for section in ('request','result'):
            receipt[section]['directory']=relocate(receipt[section]['directory'],source/'exports')
        record.write_text(json.dumps(receipt,ensure_ascii=False),'utf-8')
    return {'database':str(target_db),'preserved_photos':photos,'copied_derived_files':copied}


def migrate(source: Path, destination: Path, relocate_to: Path | None = None) -> dict:
    source,destination=source.resolve(strict=True),destination.resolve()
    final=(relocate_to or destination).resolve()
    if source==destination or source in destination.parents or destination in source.parents or source==final or source in final.parents or final in source.parents:
        raise ValueError('新照片库不能与旧库相同或互相包含')
    if destination.exists() and (not destination.is_dir() or any(destination.iterdir())):raise ValueError('新照片库必须是空目录，不会覆盖已有文件')
    destination.parent.mkdir(parents=True,exist_ok=True)
    # Copy and check on the destination volume; publication is one rename. A
    # failed copy never exposes a half-populated destination as a valid library.
    with TemporaryDirectory(prefix='.photo-library-copy-',dir=native_path(destination.parent)) as temporary:
        stage=Path(temporary);result=_copy_library(source,stage,relocate_to=final)
        if destination.exists():destination.rmdir()  # Fails rather than removes newly added files.
        stage.rename(destination)
    return result|{'database':str(destination/'library.db')}

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('source',type=Path)
    parser.add_argument('destination',type=Path)
    args=parser.parse_args()
    print(json.dumps(migrate(args.source,args.destination),ensure_ascii=True))
