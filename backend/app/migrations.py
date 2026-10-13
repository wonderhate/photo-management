"""Small, idempotent SQLite upgrades shared by startup and maintenance tools."""
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

ADDITIONS = {
    'watermark_drafts': {'artwork_id': 'VARCHAR REFERENCES artworks(id) ON DELETE RESTRICT'},
    'photos': {'gps_altitude': 'REAL', 'rating': 'INTEGER', 'color_label': 'TEXT', 'face_data': 'JSON'},
    'albums': {'cover_photo_id': 'VARCHAR', 'person_id': 'VARCHAR REFERENCES face_persons(id) ON DELETE SET NULL'},
    'album_photos': {'position': 'INTEGER NOT NULL DEFAULT 0'},
}


def backup_database(path: Path, destination: Path | None = None) -> Path:
    destination = destination or path.parent / 'backups' / f'library-{datetime.now(timezone.utc):%Y%m%dT%H%M%S%fZ}.db'
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() or destination.resolve() == path.resolve():
        raise ValueError('备份目标已存在或与源数据库相同')
    with closing(sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)) as source:
        with closing(sqlite3.connect(destination)) as target:
            source.backup(target)
    return destination


def migrate_database(path: Path, backup: bool = True) -> list[str]:
    if not path.exists():
        return []
    with closing(sqlite3.connect(path)) as connection:
        tables = {r[0] for r in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        changes = []
        for table, additions in ADDITIONS.items():
            if table not in tables:
                continue
            columns = {r[1] for r in connection.execute(f'PRAGMA table_info({table})')}
            changes.extend((table, name, declaration) for name, declaration in additions.items() if name not in columns)
        if changes and backup:
            backup_database(path)
        with connection:
            for table, name, declaration in changes:
                connection.execute(f'ALTER TABLE {table} ADD COLUMN {name} {declaration}')
            connection.execute('PRAGMA user_version=1')
    return [f'{table}.{name}' for table, name, _ in changes]
