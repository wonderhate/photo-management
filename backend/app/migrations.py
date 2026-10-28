"""Small, idempotent SQLite upgrades shared by startup and maintenance tools."""
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4
from .services.face_space import LEGACY_SPACE

ADDITIONS = {
    'embeddings': {'model_revision':"VARCHAR NOT NULL DEFAULT ''",'source_hash':"VARCHAR NOT NULL DEFAULT ''",
                   'source_signature':"VARCHAR NOT NULL DEFAULT ''",'vector_hash':"VARCHAR NOT NULL DEFAULT ''",
                   'input_hash':"VARCHAR NOT NULL DEFAULT ''",'input_signature':"VARCHAR NOT NULL DEFAULT ''",
                   'dimensions':'INTEGER NOT NULL DEFAULT 0'},
    'watermark_drafts': {'artwork_id': 'VARCHAR REFERENCES artworks(id) ON DELETE RESTRICT',
                         'asset_variant_id': 'VARCHAR REFERENCES asset_variants(id) ON DELETE RESTRICT'},
    'photos': {'removed_at':'VARCHAR','removed_original_path':'VARCHAR','gps_altitude': 'REAL', 'rating': 'INTEGER', 'color_label': 'TEXT', 'face_data': 'JSON', 'rating_source': "VARCHAR NOT NULL DEFAULT 'legacy'", 'flag': "VARCHAR NOT NULL DEFAULT 'unmarked'", 'user_description':'VARCHAR', 'annotation':'JSON', 'rejected_ai_tags':"JSON NOT NULL DEFAULT '[]'"},
    'photo_tags': {'origin':"VARCHAR NOT NULL DEFAULT 'user'"},
    'albums': {'cover_photo_id': 'VARCHAR', 'person_id': 'VARCHAR REFERENCES face_persons(id) ON DELETE SET NULL', 'query': 'JSON'},
    'album_photos': {'position': 'INTEGER NOT NULL DEFAULT 0', 'added_at': 'VARCHAR'},
    'detected_faces': {'model_space':"VARCHAR NOT NULL DEFAULT 'legacy-unverified' REFERENCES face_model_spaces(id) ON DELETE RESTRICT"},
}
SCHEMA_VERSION = 28
CREATIONS = {
    'vision_assets': '''CREATE TABLE vision_assets (id VARCHAR PRIMARY KEY NOT NULL,kind VARCHAR NOT NULL,record JSON NOT NULL,png BLOB NOT NULL)''',
    'ai_profiles': '''CREATE TABLE ai_profiles (id VARCHAR PRIMARY KEY NOT NULL,record JSON NOT NULL,encrypted_key VARCHAR)''',
    'ai_results': '''CREATE TABLE ai_results (id VARCHAR PRIMARY KEY NOT NULL,kind VARCHAR NOT NULL,photo_id VARCHAR,record JSON NOT NULL,created_at VARCHAR NOT NULL)''',
    'registered_raw_sources': '''CREATE TABLE registered_raw_sources (id VARCHAR PRIMARY KEY NOT NULL,record JSON NOT NULL)''',
    'photo_raw_relations': '''CREATE TABLE photo_raw_relations (photo_id VARCHAR PRIMARY KEY NOT NULL REFERENCES photos(id) ON DELETE CASCADE,record JSON NOT NULL)''',
    'photo_locations': '''CREATE TABLE photo_locations (photo_id VARCHAR PRIMARY KEY NOT NULL REFERENCES photos(id) ON DELETE CASCADE,record JSON NOT NULL)''',
    'visual_fingerprints': '''CREATE TABLE visual_fingerprints (photo_id VARCHAR PRIMARY KEY NOT NULL REFERENCES photos(id) ON DELETE CASCADE,record JSON NOT NULL)''',
    'frame_library_assets': '''CREATE TABLE frame_library_assets (id VARCHAR PRIMARY KEY NOT NULL,kind VARCHAR NOT NULL,record JSON NOT NULL,created_at VARCHAR NOT NULL)''',
    'media_assets': '''CREATE TABLE media_assets (id VARCHAR PRIMARY KEY NOT NULL,kind VARCHAR NOT NULL,file_path VARCHAR NOT NULL UNIQUE,file_name VARCHAR NOT NULL,file_hash VARCHAR NOT NULL UNIQUE,file_size INTEGER NOT NULL,metadata_json JSON NOT NULL,cover_path VARCHAR,created_at VARCHAR NOT NULL)''',
    'collage_outputs': '''CREATE TABLE collage_outputs (id VARCHAR PRIMARY KEY NOT NULL,record JSON NOT NULL,assets JSON NOT NULL,file_path VARCHAR NOT NULL,created_at VARCHAR NOT NULL)''',
    'collage_projects': '''CREATE TABLE collage_projects (id VARCHAR PRIMARY KEY NOT NULL,record JSON NOT NULL,assets JSON NOT NULL,updated_at VARCHAR NOT NULL)''',
    'lut_folders': '''CREATE TABLE lut_folders (id VARCHAR PRIMARY KEY NOT NULL,path VARCHAR NOT NULL UNIQUE,record JSON NOT NULL)''',
    'lut_assets': '''CREATE TABLE lut_assets (
        id VARCHAR PRIMARY KEY NOT NULL, metadata_json JSON NOT NULL,
        source BLOB NOT NULL)''',
    'face_ignores': '''CREATE TABLE face_ignores (
        person_id VARCHAR PRIMARY KEY NOT NULL REFERENCES face_persons(id) ON DELETE CASCADE,
        created_at VARCHAR NOT NULL)''',
    'face_ignored_members': '''CREATE TABLE face_ignored_members (
        person_id VARCHAR NOT NULL REFERENCES face_ignores(person_id) ON DELETE CASCADE,
        observation_key VARCHAR NOT NULL, source_hash VARCHAR NOT NULL,
        model_space VARCHAR NOT NULL REFERENCES face_model_spaces(id) ON DELETE RESTRICT,
        encoding BLOB NOT NULL, location JSON NOT NULL, confirmed BOOLEAN NOT NULL,
        created_at VARCHAR NOT NULL, PRIMARY KEY(person_id,observation_key))''',
    'face_covers': '''CREATE TABLE face_covers (
        person_id VARCHAR PRIMARY KEY NOT NULL REFERENCES face_persons(id) ON DELETE CASCADE,
        face_id VARCHAR NOT NULL REFERENCES detected_faces(id) ON DELETE CASCADE)''',
    'face_merges': '''CREATE TABLE face_merges (
        source_id VARCHAR PRIMARY KEY NOT NULL REFERENCES face_persons(id) ON DELETE CASCADE,
        target_id VARCHAR NOT NULL REFERENCES face_persons(id) ON DELETE CASCADE)''',
    'face_operations': '''CREATE TABLE face_operations (
        id VARCHAR PRIMARY KEY NOT NULL, library_id VARCHAR NOT NULL, kind VARCHAR NOT NULL,
        context JSON NOT NULL, before_state BLOB NOT NULL, after_hash VARCHAR NOT NULL,
        created_at VARCHAR NOT NULL, undone_at VARCHAR)''',
    'face_model_spaces': '''CREATE TABLE face_model_spaces (
        id VARCHAR PRIMARY KEY NOT NULL, manifest JSON NOT NULL, verified BOOLEAN NOT NULL,
        created_at VARCHAR NOT NULL)''',
    'face_prototypes': '''CREATE TABLE face_prototypes (
        person_id VARCHAR NOT NULL REFERENCES face_persons(id) ON DELETE CASCADE,
        model_space VARCHAR NOT NULL REFERENCES face_model_spaces(id) ON DELETE RESTRICT,
        encoding BLOB NOT NULL, dimensions INTEGER NOT NULL, created_at VARCHAR NOT NULL,
        PRIMARY KEY(person_id,model_space))''',
    'library_profile': '''CREATE TABLE library_profile (
        singleton INTEGER PRIMARY KEY NOT NULL CHECK(singleton=1),
        library_id VARCHAR NOT NULL UNIQUE, created_at VARCHAR NOT NULL,
        preferences JSON NOT NULL)''',
    'edit_documents': '''CREATE TABLE edit_documents (
        id VARCHAR PRIMARY KEY NOT NULL, photo_id VARCHAR REFERENCES photos(id) ON DELETE SET NULL,
        source_name VARCHAR NOT NULL, source_path VARCHAR NOT NULL, source_hash VARCHAR NOT NULL,
        source_json JSON NOT NULL, recipe JSON NOT NULL, revision INTEGER NOT NULL,
        created_at VARCHAR NOT NULL, updated_at VARCHAR NOT NULL)''',
    'asset_variants': '''CREATE TABLE asset_variants (
        id VARCHAR PRIMARY KEY NOT NULL, document_id VARCHAR NOT NULL REFERENCES edit_documents(id) ON DELETE RESTRICT,
        document_revision INTEGER NOT NULL, kind VARCHAR NOT NULL, name VARCHAR NOT NULL,
        file_path VARCHAR NOT NULL, file_hash VARCHAR NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
        recipe JSON NOT NULL, source_json JSON NOT NULL, created_at VARCHAR NOT NULL)''',
    'document_view_preferences': '''CREATE TABLE document_view_preferences (
        document_id VARCHAR PRIMARY KEY NOT NULL REFERENCES edit_documents(id) ON DELETE CASCADE,
        preferences JSON NOT NULL)''',
}


def backup_database(path: Path, destination: Path | None = None) -> Path:
    import os
    from tempfile import TemporaryDirectory
    destination = destination or path.parent / 'backups' / f'library-{datetime.now(timezone.utc):%Y%m%dT%H%M%S%fZ}.db'
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() or destination.resolve() == path.resolve():
        raise ValueError('备份目标已存在或与源数据库相同')
    # A failed or interrupted backup must never look like a restorable .db.
    # Stage on the destination volume and publish only the checked snapshot.
    with TemporaryDirectory(prefix='.database-backup-', dir=destination.parent) as folder:
        staged = Path(folder) / 'snapshot.db'
        with closing(sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)) as source:
            with closing(sqlite3.connect(staged)) as target:
                source.backup(target)
                if target.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
                    raise ValueError('Database backup integrity check failed')
        with staged.open('r+b') as stream:
            os.fsync(stream.fileno())
        if os.name == 'nt':
            staged.rename(destination)  # Windows rename refuses an existing destination.
        else:
            os.link(staged, destination)  # Atomic, exclusive publication on POSIX.
    return destination


def migrate_database(path: Path, backup: bool = True) -> list[str]:
    if not path.exists():
        return []
    with closing(sqlite3.connect(path)) as connection:
        version = connection.execute('PRAGMA user_version').fetchone()[0]
        if version > SCHEMA_VERSION:
            raise ValueError('照片库版本较新，请使用支持该版本的程序')
        tables = {r[0] for r in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if version<26:
            if 'photos' in tables and 'removed_at' in {r[1] for r in connection.execute('PRAGMA table_info(photos)')} and connection.execute('SELECT 1 FROM photos WHERE removed_at IS NOT NULL LIMIT 1').fetchone():raise ValueError('Removed photo records require a compatible library version.')
            for table in ('registered_raw_sources','photo_raw_relations'):
                if table in tables and connection.execute(f'SELECT 1 FROM {table} LIMIT 1').fetchone():raise ValueError('RAW source records require a compatible library version.')
        if version<26 and 'photo_locations' in tables and connection.execute('SELECT 1 FROM photo_locations LIMIT 1').fetchone():
            raise ValueError('Photo locations require a compatible library version.')
        if version<25 and 'visual_fingerprints' in tables and connection.execute('SELECT 1 FROM visual_fingerprints LIMIT 1').fetchone():
            raise ValueError('Appearance fingerprints require a compatible library version.')
        if version<25 and 'embeddings' in tables:
            columns={row[1] for row in connection.execute('PRAGMA table_info(embeddings)')}
            if 'model_revision' in columns and connection.execute("SELECT 1 FROM embeddings WHERE model_revision<>'' LIMIT 1").fetchone():
                raise ValueError('Semantic vector provenance requires a compatible library version.')
        if version<17 and 'edit_documents' in tables:
            import json
            for (recipe,) in connection.execute('SELECT recipe FROM edit_documents'):
                if json.loads(recipe).get('version')==3:raise ValueError('文字配方与照片库版本不一致，请从兼容备份恢复')
        if version<18:
            import json
            for table in ('edit_documents','asset_variants'):
                if table in tables:
                    for (recipe,) in connection.execute(f'SELECT recipe FROM {table}'):
                        if json.loads(recipe).get('version')==4:raise ValueError('图层配方与照片库版本不一致，请从兼容备份恢复')
        if version<19:
            import json
            if 'lut_assets' in tables and connection.execute('SELECT 1 FROM lut_assets LIMIT 1').fetchone():raise ValueError('LUT data requires a compatible library version.')
            for table in ('edit_documents','asset_variants'):
                if table in tables:
                    for (recipe,) in connection.execute(f'SELECT recipe FROM {table}'):
                        if json.loads(recipe).get('version')==5:raise ValueError('LUT data requires a compatible library version.')
        if version<20 and 'lut_folders' in tables and connection.execute('SELECT 1 FROM lut_folders LIMIT 1').fetchone():raise ValueError('LUT folders require a compatible library version.')
        if version<21 and 'lut_assets' in tables:
            import json
            if any(json.loads(row[0]).get('version')==2 for row in connection.execute('SELECT metadata_json FROM lut_assets')):raise ValueError('LUT source context requires a compatible library version.')
        if version<22 and 'collage_projects' in tables and connection.execute('SELECT 1 FROM collage_projects LIMIT 1').fetchone():raise ValueError('Collage projects require a compatible library version.')
        if version<24 and 'frame_library_assets' in tables and connection.execute('SELECT 1 FROM frame_library_assets LIMIT 1').fetchone():raise ValueError('Frame assets require a compatible library version.')
        if version<24 and 'media_assets' in tables and connection.execute('SELECT 1 FROM media_assets LIMIT 1').fetchone():raise ValueError('Media assets require a compatible library version.')
        if version<23 and 'collage_outputs' in tables and connection.execute('SELECT 1 FROM collage_outputs LIMIT 1').fetchone():raise ValueError('Collage outputs require a compatible library version.')
        if version<24 and 'watermark_drafts' in tables and 'settings_json' in {row[1] for row in connection.execute('PRAGMA table_info(watermark_drafts)')}:
            import json
            if any(json.loads(row[0]).get('frame_v2') is not None or json.loads(row[0]).get('format')=='webp' for row in connection.execute('SELECT settings_json FROM watermark_drafts')):
                raise ValueError('Frame assets require a compatible library version.')
        if version<28:
            import json
            if 'vision_assets' in tables and connection.execute('SELECT 1 FROM vision_assets LIMIT 1').fetchone():raise ValueError('Local vision assets require a compatible library version.')
            for table in ('edit_documents','asset_variants'):
                if table in tables:
                    for (recipe,) in connection.execute(f'SELECT recipe FROM {table}'):
                        if json.loads(recipe).get('layer_stack',{}).get('version')==2:raise ValueError('Layer documents require a compatible library version.')
        changes = []
        for table, additions in ADDITIONS.items():
            if table not in tables:
                continue
            columns = {r[1] for r in connection.execute(f'PRAGMA table_info({table})')}
            changes.extend((table, name, declaration) for name, declaration in additions.items() if name not in columns)
        creations = [name for name in CREATIONS if 'photos' in tables and name not in tables]
        semantic_upgrade = 'photos' in tables and version < SCHEMA_VERSION
        if (changes or creations or semantic_upgrade) and backup:
            backup_database(path)
        with connection:
            connection.execute('BEGIN IMMEDIATE')
            for name in creations:
                connection.execute(CREATIONS[name])
            if 'photos' in tables:
                connection.execute('INSERT OR IGNORE INTO face_model_spaces VALUES (?,?,?,?)', (LEGACY_SPACE,'{}',False,datetime.now(timezone.utc).isoformat()))
            for table, name, declaration in changes:
                connection.execute(f'ALTER TABLE {table} ADD COLUMN {name} {declaration}')
            if semantic_upgrade and version<12 and 'face_persons' in tables:
                columns={row[1] for row in connection.execute('PRAGMA table_info(face_persons)')}
                if 'representative_encoding' in columns:
                    connection.execute('''INSERT OR IGNORE INTO face_prototypes
                        SELECT id,?,representative_encoding,
                        CASE WHEN length(representative_encoding)%4=0 THEN length(representative_encoding)/4 ELSE 0 END,created_at
                        FROM face_persons WHERE representative_encoding IS NOT NULL''',(LEGACY_SPACE,))
            if 'photos' in tables:
                connection.execute('INSERT OR IGNORE INTO library_profile VALUES (1,?,?,?)',
                    (str(uuid4()), datetime.now(timezone.utc).isoformat(), '{}'))
            connection.execute(f'PRAGMA user_version={SCHEMA_VERSION}')
    return [f'{table}.{name}' for table, name, _ in changes] + creations + (['source_decode_profile:v2'] if semantic_upgrade and version < 4 else [])
