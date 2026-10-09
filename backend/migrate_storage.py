"""Copy a library database and its derived files to an explicit destination.

Original photo paths remain unchanged. The source library remains as a fallback.
Run with the application stopped before changing library-config.json.
"""
import argparse
import json
from pathlib import Path
import shutil
import sqlite3

def migrate(source: Path, destination: Path) -> dict:
    source, destination = source.resolve(strict=True), destination.resolve(strict=True)
    if source == destination:
        raise ValueError('Source and destination must differ')
    target_db = destination / 'library.db'
    if target_db.exists():
        raise FileExistsError(f'Refusing to overwrite an existing library: {target_db}')
    copied = 0
    for name in ('thumbnails','previews','embeddings','exports','export-records'):
        folder = source / name
        if not folder.is_dir(): continue
        for original in folder.rglob('*'):
            if not original.is_file(): continue
            target = destination / name / original.relative_to(folder)
            if target.exists():
                raise FileExistsError(f'Refusing to overwrite an existing file: {target}')
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(original, target)
            copied += 1
    for name in ('settings.json',):
        if (source/name).is_file() and not (destination/name).exists():
            shutil.copy2(source/name, destination/name)
    with sqlite3.connect(source/'library.db') as old, sqlite3.connect(target_db) as new:
        old.backup(new)
        for table, field in [('photos','thumbnail_path'),('photos','preview_path'),('embeddings','embedding_path')]:
            rows = new.execute(f'SELECT rowid, {field} FROM {table} WHERE {field} IS NOT NULL').fetchall()
            for row_id, value in rows:
                try: relative = Path(value).relative_to(source)
                except ValueError: continue
                new.execute(f'UPDATE {table} SET {field}=? WHERE rowid=?', (str(destination/relative),row_id))
        new.commit()
        photos = new.execute('SELECT COUNT(*) FROM photos').fetchone()[0]
        assert new.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    return {'database':str(target_db),'preserved_photos':photos,'copied_derived_files':copied}

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('source',type=Path)
    parser.add_argument('destination',type=Path)
    args=parser.parse_args()
    print(json.dumps(migrate(args.source,args.destination),ensure_ascii=True))
