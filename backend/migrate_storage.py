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

def native_path(path: Path) -> Path:
    value = str(path.resolve())
    if os.name != 'nt' or value.startswith('\\\\?\\'):
        return Path(value)
    return Path('\\\\?\\UNC\\' + value[2:] if value.startswith('\\\\') else '\\\\?\\' + value)

def migrate(source: Path, destination: Path, relocate_to: Path | None = None) -> dict:
    source, destination = source.resolve(strict=True), destination.resolve()
    final = (relocate_to or destination).resolve()
    if source == final or source in final.parents or final in source.parents:
        raise ValueError('新照片库不能与旧库相同或互相包含')
    if not (source/'library.db').is_file():
        raise ValueError('源照片库数据库不存在')
    if destination.exists() and (not destination.is_dir() or any(destination.iterdir())):
        raise ValueError('新照片库必须是空目录，不会覆盖已有文件')
    destination.mkdir(parents=True, exist_ok=True)
    target_db = destination / 'library.db'
    if target_db.exists():
        raise FileExistsError(f'Refusing to overwrite an existing library: {target_db}')
    copied = 0
    for name in ('thumbnails','previews','watermark_previews','embeddings','exports','export-records','faces','imports','plugins','backups','artworks'):
        folder = source / name
        if not folder.is_dir(): continue
        for original in folder.rglob('*'):
            if not original.is_file(): continue
            target = destination / name / original.relative_to(folder)
            if target.exists():
                raise FileExistsError(f'Refusing to overwrite an existing file: {target}')
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(native_path(original), native_path(target))
            copied += 1
    for name in ('settings.json', 'art-key.dpapi', 'qwen-art-key.dpapi'):
        if (source/name).is_file() and not (destination/name).exists():
            shutil.copy2(native_path(source/name), native_path(destination/name))
    def relocate(value, root=source):
        try: return str(final / root.relative_to(source) / Path(value).relative_to(root))
        except (ValueError, TypeError): return value
    with closing(sqlite3.connect((source/'library.db').as_uri()+'?mode=ro',uri=True)) as old, closing(sqlite3.connect(target_db)) as new:
        old.backup(new)
        tables={row[0] for row in new.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        for table, field in [('photos','thumbnail_path'),('photos','preview_path'),('embeddings','embedding_path'),('watermark_drafts','preview_path'),('watermark_drafts','export_path')]:
            if table not in tables: continue
            rows = new.execute(f'SELECT rowid, {field} FROM {table} WHERE {field} IS NOT NULL').fetchall()
            for row_id, value in rows:
                new.execute(f'UPDATE {table} SET {field}=? WHERE rowid=?', (relocate(value),row_id))
        # Only browser-managed originals are copied; external originals keep their paths.
        for row_id, value in new.execute('SELECT rowid,file_path FROM photos').fetchall():
            updated=relocate(value,source/'imports')
            if updated!=value:
                new.execute('UPDATE photos SET file_path=?,source_directory=? WHERE rowid=?',(updated,str(Path(updated).parent).casefold(),row_id))
        if 'watermark_drafts' in tables:
            for row_id,value in new.execute('SELECT rowid,source_json FROM watermark_drafts').fetchall():
                snapshot=json.loads(value)
                snapshot['file_path']=relocate(snapshot.get('file_path'),source/'imports')
                new.execute('UPDATE watermark_drafts SET source_json=? WHERE rowid=?',(json.dumps(snapshot,ensure_ascii=False),row_id))
        new.commit()
        photos = new.execute('SELECT COUNT(*) FROM photos').fetchone()[0]
        if new.execute('PRAGMA integrity_check').fetchone()[0]!='ok' or new.execute('PRAGMA foreign_key_check').fetchall():
            raise ValueError('照片库复制后的数据库校验失败')
    for record in (destination/'export-records').glob('*.json'):
        metadata=json.loads(record.read_text('utf-8'))
        if not metadata.get('custom'): metadata['file_path']=relocate(metadata['file_path'])
        record.write_text(json.dumps(metadata,ensure_ascii=False),'utf-8')
    return {'database':str(target_db),'preserved_photos':photos,'copied_derived_files':copied}

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('source',type=Path)
    parser.add_argument('destination',type=Path)
    args=parser.parse_args()
    print(json.dumps(migrate(args.source,args.destination),ensure_ascii=True))
