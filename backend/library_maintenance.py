"""Merge library records and relink moved originals without touching image bytes.

Always builds and validates a staged database. --apply takes consistent backups
before replacing the target, and must be used with the application stopped.
"""
import argparse
from contextlib import closing
import json
import sqlite3
import sys
from pathlib import Path
from uuid import uuid4

if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.app.migrations import backup_database, migrate_database


def records(connection: sqlite3.Connection, table: str) -> list[dict]:
    if not connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
        return []
    return [dict(row) for row in connection.execute(f'SELECT * FROM {table}')]


def relocate(value: str | None, old: Path, new: Path, require_exists: bool = False) -> str | None:
    if not value:
        return value
    try:
        candidate = new / Path(value).relative_to(old)
    except ValueError:
        return value
    return str(candidate) if not require_exists or candidate.is_file() else value


def insert(connection: sqlite3.Connection, table: str, row: dict) -> None:
    columns = {r[1] for r in connection.execute(f'PRAGMA table_info({table})')}
    row = {key: value for key, value in row.items() if key in columns}
    names = list(row)
    connection.execute(f'INSERT INTO {table} ({",".join(names)}) VALUES ({",".join("?" for _ in names)})', list(row.values()))


def merge_libraries(target: Path, source: Path, stage: Path, old: Path, new: Path) -> dict:
    if len({p.resolve() for p in (target, source, stage)}) != 3:
        raise ValueError('源库、目标库和暂存库必须不同')
    backup_database(target, stage)
    migrate_database(stage, backup=False)
    with closing(sqlite3.connect(stage)) as destination, closing(sqlite3.connect(source.resolve().as_uri() + '?mode=ro', uri=True)) as incoming, destination:
        destination.row_factory = incoming.row_factory = sqlite3.Row
        # Existing destination tables define the current application schema.
        target_photos = records(destination, 'photos')
        source_photos = records(incoming, 'photos')
        by_hash = {p['file_hash']: p for p in target_photos}
        preserved_analysis = {p['id'] for p in target_photos if json.loads(p.get('face_data') or '{}').get('model')}
        occupied = {p['id'] for p in target_photos}
        photo_ids = {p['id']: by_hash[p['file_hash']]['id'] if p['file_hash'] in by_hash else (str(uuid4()) if p['id'] in occupied else p['id']) for p in source_photos}
        group_ids = {}
        existing_groups = {g['id'] for g in records(destination, 'capture_groups')}
        for group in records(incoming, 'capture_groups'):
            overlaps = {by_hash[p['file_hash']]['capture_group_id'] for p in source_photos if p['capture_group_id'] == group['id'] and p['file_hash'] in by_hash}
            if len(overlaps) > 1:
                raise ValueError('拍摄组存在冲突，需要人工处理')
            group_ids[group['id']] = next(iter(overlaps)) if overlaps else (str(uuid4()) if group['id'] in existing_groups else group['id'])
            if not overlaps:
                insert(destination, 'capture_groups', group | {'id': group_ids[group['id']], 'preferred_photo_id': photo_ids.get(group['preferred_photo_id'])})
        added = 0
        for photo in source_photos:
            if photo['file_hash'] in by_hash:
                current = by_hash[photo['file_hash']]
                if photo.get('favorite'):
                    destination.execute('UPDATE photos SET favorite=1 WHERE id=?', (current['id'],))
                # Preserve destination edits while filling missing metadata.
                for key, value in photo.items():
                    missing = current.get(key) is None or (key == 'face_data' and current['id'] not in preserved_analysis)
                    if key not in ('id','capture_group_id') and missing and value is not None:
                        destination.execute(f'UPDATE photos SET {key}=? WHERE id=?', (value, current['id']))
                continue
            insert(destination, 'photos', photo | {'id': photo_ids[photo['id']], 'capture_group_id': group_ids[photo['capture_group_id']]})
            added += 1
        mappings = {'photo_id': photo_ids, 'capture_group_id': group_ids}
        for table, unique in [('tags','name'), ('albums',None), ('watermark_drafts',None), ('face_persons','name')]:
            current = records(destination, table)
            if not destination.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
                if records(incoming, table):
                    raise ValueError(f'目标库缺少 {table}，请先用当前程序升级目标库')
                continue
            current_ids = {row['id'] for row in current}
            names = {row[unique]: row['id'] for row in current} if unique else {}
            table_ids = {}
            for row in records(incoming, table):
                if unique and row[unique] in names:
                    table_ids[row['id']] = names[row[unique]]
                    continue
                new_id = str(uuid4()) if row['id'] in current_ids else row['id']
                table_ids[row['id']] = new_id
                value = row | {'id': new_id}
                for key, mapping in mappings.items():
                    if key in value:
                        value[key] = mapping.get(value[key], value[key])
                if table == 'albums':
                    value['cover_photo_id'] = photo_ids.get(value.get('cover_photo_id'), value.get('cover_photo_id'))
                insert(destination, table, value)
            if table in ('tags','albums','face_persons'):
                mappings[{'tags':'tag_id','albums':'album_id','face_persons':'person_id'}[table]] = table_ids
        for table in ('album_photos','photo_tags','embeddings'):
            for row in records(incoming, table):
                value = {key: mappings.get(key, {}).get(item, item) for key, item in row.items()}
                keys = ('album_id','photo_id') if table == 'album_photos' else ('photo_id','tag_id') if table == 'photo_tags' else ('photo_id','model')
                if not destination.execute(f'SELECT 1 FROM {table} WHERE '+ ' AND '.join(f'{key}=?' for key in keys), [value[key] for key in keys]).fetchone():
                    insert(destination, table, value)
        existing_faces = records(destination, 'detected_faces')
        occupied_faces = {row['id'] for row in existing_faces}
        face_keys = {(row['photo_id'], row['face_index']) for row in existing_faces}
        for row in records(incoming, 'detected_faces'):
            photo_id = photo_ids[row['photo_id']]
            if photo_id in preserved_analysis:
                continue
            key = (photo_id, row['face_index'])
            if key in face_keys:
                continue  # Keep the destination's identity confirmation for shared photos.
            insert(destination, 'detected_faces', row | {
                'id': str(uuid4()) if row['id'] in occupied_faces else row['id'],
                'photo_id': photo_id,
                'person_id': mappings.get('person_id', {}).get(row['person_id'], row['person_id']),
            })
            face_keys.add(key)
        for photo in records(destination, 'photos'):
            original = relocate(photo['file_path'], old, new)
            destination.execute('UPDATE photos SET file_path=?, source_directory=?, thumbnail_path=?, preview_path=? WHERE id=?',
                (original, str(Path(original).parent).casefold(), relocate(photo.get('thumbnail_path'), old, new, True), relocate(photo.get('preview_path'), old, new, True), photo['id']))
        for table, key in [('embeddings','embedding_path'), ('watermark_drafts','preview_path')]:
            for row in records(destination, table):
                where = 'photo_id=? AND model=?' if table == 'embeddings' else 'id=?'
                values = [row['photo_id'], row['model']] if table == 'embeddings' else [row['id']]
                destination.execute(f'UPDATE {table} SET {key}=? WHERE {where}', [relocate(row.get(key), old, new, True)] + values)
        for draft in records(destination, 'watermark_drafts'):
            snapshot = json.loads(draft['source_json'])
            snapshot['file_path'] = relocate(snapshot.get('file_path'), old, new)
            destination.execute('UPDATE watermark_drafts SET source_json=? WHERE id=?', (json.dumps(snapshot, ensure_ascii=False), draft['id']))
        violations = destination.execute('PRAGMA foreign_key_check').fetchall()
        integrity = destination.execute('PRAGMA integrity_check').fetchone()[0]
        if violations or integrity != 'ok':
            raise ValueError(f'合并校验失败：{integrity}，外键冲突 {len(violations)}')
        photos = records(destination, 'photos')
        return {'added': added, 'files': len(photos), 'captures': len(records(destination,'capture_groups')), 'drafts': len(records(destination,'watermark_drafts')),
                'missing': [p['file_path'] for p in photos if not Path(p['file_path']).is_file()], 'integrity': integrity, 'stage':str(stage)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for argument in ('target','source','stage','old-root','new-root'):
        parser.add_argument('--'+argument, required=True, type=Path)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    result = merge_libraries(args.target, args.source, args.stage, args.old_root, args.new_root)
    if args.apply:
        result['backups'] = [str(backup_database(path)) for path in (args.target, args.source)]
        # SQLite backup handles live WAL correctly; caller stops the server before apply.
        with closing(sqlite3.connect(args.stage)) as stage, closing(sqlite3.connect(args.target)) as target:
            stage.backup(target)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
