from datetime import datetime, timezone
from uuid import uuid4
from pathlib import Path
from sqlalchemy import String, ForeignKey, JSON, Index, LargeBinary, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker, Session as OrmSession, with_loader_criteria
from .config import DATA
from .services.face_space import LEGACY_SPACE

def uid() -> str:
    return str(uuid4())

def now() -> str:
    return datetime.now(timezone.utc).isoformat()

class Base(DeclarativeBase):
    pass

class VisionAsset(Base):
    __tablename__ = 'vision_assets'
    id: Mapped[str] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column()
    record: Mapped[dict] = mapped_column(JSON)
    png: Mapped[bytes] = mapped_column(LargeBinary)


class AIProfile(Base):
    __tablename__ = 'ai_profiles'
    id: Mapped[str] = mapped_column(primary_key=True,default=uid)
    record: Mapped[dict] = mapped_column(JSON)
    encrypted_key: Mapped[str | None] = mapped_column(String)


class AIResult(Base):
    __tablename__ = 'ai_results'
    id: Mapped[str] = mapped_column(primary_key=True,default=uid)
    kind: Mapped[str] = mapped_column(index=True)
    photo_id: Mapped[str | None] = mapped_column(index=True)
    record: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[str] = mapped_column(default=now,index=True)


class LibraryProfile(Base):
    __tablename__ = 'library_profile'
    singleton: Mapped[int] = mapped_column(primary_key=True, default=1)
    library_id: Mapped[str] = mapped_column(unique=True, default=uid)
    created_at: Mapped[str] = mapped_column(default=now)
    preferences: Mapped[dict] = mapped_column(JSON, default=dict)

class DocumentViewPreference(Base):
    __tablename__ = 'document_view_preferences'
    document_id: Mapped[str] = mapped_column(ForeignKey('edit_documents.id', ondelete='CASCADE'), primary_key=True)
    preferences: Mapped[dict] = mapped_column(JSON, default=dict)

class CaptureGroup(Base):
    __tablename__ = 'capture_groups'
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    preferred_photo_id: Mapped[str | None]
    date_taken: Mapped[str | None]
    camera_model: Mapped[str | None]
    created_at: Mapped[str] = mapped_column(default=now)

class WatermarkDraft(Base):
    __tablename__ = 'watermark_drafts'
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    photo_id: Mapped[str | None] = mapped_column(ForeignKey('photos.id', ondelete='SET NULL'), index=True)
    artwork_id: Mapped[str | None] = mapped_column(ForeignKey('artworks.id', ondelete='RESTRICT'), index=True)
    asset_variant_id: Mapped[str | None] = mapped_column(ForeignKey('asset_variants.id', ondelete='RESTRICT'), index=True)
    capture_group_id: Mapped[str | None] = mapped_column(index=True)
    name: Mapped[str]
    watermark_type: Mapped[str] = mapped_column(index=True)
    template_id: Mapped[str]
    settings_json: Mapped[dict] = mapped_column(JSON)
    source_json: Mapped[dict] = mapped_column(JSON)
    preview_path: Mapped[str | None]
    status: Mapped[str] = mapped_column(default='draft', index=True)
    revision: Mapped[int] = mapped_column(default=1)
    exported_revision: Mapped[int | None]
    created_at: Mapped[str] = mapped_column(default=now)
    updated_at: Mapped[str] = mapped_column(default=now, index=True)
    last_exported_at: Mapped[str | None]
    export_path: Mapped[str | None]

class Photo(Base):
    __tablename__ = 'photos'
    removed_at: Mapped[str | None] = mapped_column(String,index=True)
    removed_original_path: Mapped[str | None] = mapped_column(String)
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    file_path: Mapped[str] = mapped_column(unique=True)
    file_name: Mapped[str]
    file_stem: Mapped[str] = mapped_column(index=True)
    source_directory: Mapped[str] = mapped_column(index=True)
    file_hash: Mapped[str] = mapped_column(unique=True, index=True)
    file_format: Mapped[str]
    file_size: Mapped[int]
    is_raw: Mapped[bool] = mapped_column(default=False)
    capture_group_id: Mapped[str] = mapped_column(ForeignKey('capture_groups.id'), index=True)
    width: Mapped[int | None]
    height: Mapped[int | None]
    orientation: Mapped[int | None]
    date_taken: Mapped[str | None] = mapped_column(index=True)
    camera_make: Mapped[str | None]
    camera_model: Mapped[str | None] = mapped_column(index=True)
    lens_model: Mapped[str | None] = mapped_column(index=True)
    f_number: Mapped[float | None] = mapped_column(index=True)
    exposure_time: Mapped[str | None]
    exposure_seconds: Mapped[float | None] = mapped_column(index=True)
    iso: Mapped[int | None] = mapped_column(index=True)
    focal_length: Mapped[float | None] = mapped_column(index=True)
    focal_length_35mm: Mapped[float | None]
    gps_latitude: Mapped[float | None] = mapped_column(index=True)
    gps_longitude: Mapped[float | None] = mapped_column(index=True)
    gps_altitude: Mapped[float | None]
    raw_exif: Mapped[dict] = mapped_column(JSON, default=dict)
    thumbnail_path: Mapped[str | None]
    preview_path: Mapped[str | None]
    preview_error: Mapped[str | None]
    favorite: Mapped[bool] = mapped_column(default=False, index=True)
    rating: Mapped[int | None] = mapped_column(index=True)
    rating_source: Mapped[str] = mapped_column(default='legacy')
    flag: Mapped[str] = mapped_column(default='unmarked',index=True)
    user_description: Mapped[str | None]
    annotation: Mapped[dict | None] = mapped_column(JSON)
    rejected_ai_tags: Mapped[list] = mapped_column(JSON,default=list)
    color_label: Mapped[str | None] = mapped_column(index=True)
    face_data: Mapped[dict | None] = mapped_column(JSON, default=dict)
    created_at: Mapped[str] = mapped_column(default=now)
    updated_at: Mapped[str] = mapped_column(default=now, onupdate=now)

class RegisteredRawSource(Base):
    __tablename__='registered_raw_sources'
    id: Mapped[str]=mapped_column(String,primary_key=True)
    record: Mapped[dict]=mapped_column(JSON)


class PhotoRawRelation(Base):
    __tablename__='photo_raw_relations'
    photo_id: Mapped[str]=mapped_column(ForeignKey('photos.id',ondelete='CASCADE'),primary_key=True)
    record: Mapped[dict]=mapped_column(JSON)


class PhotoLocation(Base):
    __tablename__ = 'photo_locations'
    photo_id: Mapped[str] = mapped_column(ForeignKey('photos.id', ondelete='CASCADE'), primary_key=True)
    record: Mapped[dict] = mapped_column(JSON)

class FrameLibraryAsset(Base):
    __tablename__ = 'frame_library_assets'
    id: Mapped[str] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(index=True)
    record: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[str] = mapped_column(default=now)


class MediaAsset(Base):
    # Videos never enter Photo/CaptureGroup queries, reports or face indexing.
    __tablename__ = 'media_assets'
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    kind: Mapped[str] = mapped_column(default='video')
    file_path: Mapped[str] = mapped_column(unique=True)
    file_name: Mapped[str]
    file_hash: Mapped[str] = mapped_column(unique=True, index=True)
    file_size: Mapped[int]
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)
    cover_path: Mapped[str | None]
    created_at: Mapped[str] = mapped_column(default=now)


class Artwork(Base):
    __tablename__ = 'artworks'
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    photo_id: Mapped[str | None] = mapped_column(ForeignKey('photos.id', ondelete='SET NULL'), index=True)
    source_json: Mapped[dict] = mapped_column(JSON)
    settings_json: Mapped[dict] = mapped_column(JSON)
    generation_json: Mapped[dict] = mapped_column(JSON)
    width: Mapped[int]
    height: Mapped[int]
    revision: Mapped[int] = mapped_column(default=1)
    created_at: Mapped[str] = mapped_column(default=now, index=True)

class Album(Base):
    __tablename__ = 'albums'
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    name: Mapped[str]
    person_id: Mapped[str | None] = mapped_column(ForeignKey('face_persons.id', ondelete='SET NULL'), index=True)
    type: Mapped[str] = mapped_column(default='normal')
    query: Mapped[dict | None] = mapped_column(JSON)
    keywords: Mapped[list] = mapped_column(JSON, default=list)
    match_mode: Mapped[str] = mapped_column(default='any')
    threshold: Mapped[float] = mapped_column(default=0.38)
    ai_model: Mapped[str | None]
    max_results: Mapped[int] = mapped_column(default=100)
    cover_photo_id: Mapped[str | None]
    created_at: Mapped[str] = mapped_column(default=now)
    updated_at: Mapped[str] = mapped_column(default=now, onupdate=now)

class AlbumPhoto(Base):
    __tablename__ = 'album_photos'
    album_id: Mapped[str] = mapped_column(ForeignKey('albums.id', ondelete='CASCADE'), primary_key=True)
    photo_id: Mapped[str] = mapped_column(ForeignKey('photos.id', ondelete='CASCADE'), primary_key=True)
    similarity_score: Mapped[float | None]
    position: Mapped[int] = mapped_column(default=0)
    added_at: Mapped[str | None] = mapped_column(default=now)

class Tag(Base):
    __tablename__ = 'tags'
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(unique=True)

class PhotoTag(Base):
    __tablename__ = 'photo_tags'
    photo_id: Mapped[str] = mapped_column(ForeignKey('photos.id', ondelete='CASCADE'), primary_key=True)
    tag_id: Mapped[str] = mapped_column(ForeignKey('tags.id', ondelete='CASCADE'), primary_key=True)
    origin: Mapped[str] = mapped_column(default='user')

class VisualFingerprint(Base):
    __tablename__ = 'visual_fingerprints'
    photo_id: Mapped[str] = mapped_column(ForeignKey('photos.id', ondelete='CASCADE'), primary_key=True)
    record: Mapped[dict] = mapped_column(JSON)

class Embedding(Base):
    __tablename__ = 'embeddings'
    photo_id: Mapped[str] = mapped_column(ForeignKey('photos.id', ondelete='CASCADE'), primary_key=True)
    model: Mapped[str] = mapped_column(primary_key=True)
    embedding_path: Mapped[str]
    model_revision: Mapped[str] = mapped_column(default='')
    source_hash: Mapped[str] = mapped_column(default='')
    source_signature: Mapped[str] = mapped_column(default='')
    input_hash: Mapped[str] = mapped_column(default='')
    input_signature: Mapped[str] = mapped_column(default='')
    vector_hash: Mapped[str] = mapped_column(default='')
    dimensions: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[str] = mapped_column(default=now)

class FacePerson(Base):
    __tablename__ = 'face_persons'
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(unique=True)
    representative_encoding: Mapped[bytes | None]
    photo_count: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[str] = mapped_column(default=now)
    updated_at: Mapped[str] = mapped_column(default=now, onupdate=now)

class FaceModelSpace(Base):
    __tablename__ = 'face_model_spaces'
    id: Mapped[str] = mapped_column(primary_key=True)
    manifest: Mapped[dict] = mapped_column(JSON,default=dict)
    verified: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[str] = mapped_column(default=now)

class FacePrototype(Base):
    __tablename__ = 'face_prototypes'
    person_id: Mapped[str] = mapped_column(ForeignKey('face_persons.id',ondelete='CASCADE'),primary_key=True)
    model_space: Mapped[str] = mapped_column(ForeignKey('face_model_spaces.id',ondelete='RESTRICT'),primary_key=True)
    encoding: Mapped[bytes]
    dimensions: Mapped[int]
    created_at: Mapped[str] = mapped_column(default=now)

class FaceCover(Base):
    __tablename__ = 'face_covers'
    person_id: Mapped[str] = mapped_column(ForeignKey('face_persons.id',ondelete='CASCADE'),primary_key=True)
    face_id: Mapped[str] = mapped_column(ForeignKey('detected_faces.id',ondelete='CASCADE'))

class FaceMerge(Base):
    # Retain historical person IDs and album links instead of deleting a merged person.
    __tablename__ = 'face_merges'
    source_id: Mapped[str] = mapped_column(ForeignKey('face_persons.id',ondelete='CASCADE'),primary_key=True)
    target_id: Mapped[str] = mapped_column(ForeignKey('face_persons.id',ondelete='CASCADE'),index=True)

class FaceIgnore(Base):
    __tablename__ = 'face_ignores'
    person_id: Mapped[str] = mapped_column(ForeignKey('face_persons.id',ondelete='CASCADE'),primary_key=True)
    created_at: Mapped[str] = mapped_column(default=now)

class FaceIgnoredMember(Base):
    # Deliberately independent of observation/photo FKs: an analysis cache may be rebuilt.
    __tablename__ = 'face_ignored_members'
    person_id: Mapped[str] = mapped_column(ForeignKey('face_ignores.person_id',ondelete='CASCADE'),primary_key=True)
    observation_key: Mapped[str] = mapped_column(primary_key=True)
    source_hash: Mapped[str]
    model_space: Mapped[str] = mapped_column(ForeignKey('face_model_spaces.id',ondelete='RESTRICT'))
    encoding: Mapped[bytes]
    location: Mapped[dict] = mapped_column(JSON)
    confirmed: Mapped[bool]
    created_at: Mapped[str] = mapped_column(default=now)

class FaceOperation(Base):
    __tablename__ = 'face_operations'
    id: Mapped[str] = mapped_column(primary_key=True,default=uid)
    library_id: Mapped[str]
    kind: Mapped[str]
    context: Mapped[dict] = mapped_column(JSON)
    before_state: Mapped[bytes]
    after_hash: Mapped[str]
    created_at: Mapped[str] = mapped_column(default=now,index=True)
    undone_at: Mapped[str | None]

class JobRecord(Base):
    __tablename__ = 'jobs'
    id: Mapped[str] = mapped_column(primary_key=True)
    payload: Mapped[dict] = mapped_column(JSON)
    updated_at: Mapped[str] = mapped_column(default=now,index=True)

class LutFolder(Base):
    __tablename__='lut_folders'
    id: Mapped[str]=mapped_column(String,primary_key=True)
    path: Mapped[str]=mapped_column(String,unique=True)
    record: Mapped[dict]=mapped_column(JSON)


class LutAsset(Base):
    __tablename__='lut_assets'
    id: Mapped[str]=mapped_column(String,primary_key=True)
    metadata_json: Mapped[dict]=mapped_column(JSON)
    source: Mapped[bytes]=mapped_column(LargeBinary)


class CollageOutput(Base):
    __tablename__="collage_outputs"
    id: Mapped[str]=mapped_column(String,primary_key=True)
    record: Mapped[dict]=mapped_column(JSON)
    assets: Mapped[dict]=mapped_column(JSON)
    file_path: Mapped[str]=mapped_column(String)
    created_at: Mapped[str]=mapped_column(String,index=True)


class CollageProject(Base):
    __tablename__='collage_projects'
    id: Mapped[str]=mapped_column(String,primary_key=True)
    record: Mapped[dict]=mapped_column(JSON)
    assets: Mapped[dict]=mapped_column(JSON)
    updated_at: Mapped[str]=mapped_column(String,index=True)


class EditDocument(Base):
    __tablename__ = 'edit_documents'
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    photo_id: Mapped[str | None] = mapped_column(ForeignKey('photos.id', ondelete='SET NULL'), index=True)
    source_name: Mapped[str]
    source_path: Mapped[str]
    source_hash: Mapped[str] = mapped_column(index=True)
    source_json: Mapped[dict] = mapped_column(JSON, default=dict)
    recipe: Mapped[dict] = mapped_column(JSON)
    revision: Mapped[int] = mapped_column(default=1)
    created_at: Mapped[str] = mapped_column(default=now)
    updated_at: Mapped[str] = mapped_column(default=now, index=True)

class AssetVariant(Base):
    __tablename__ = 'asset_variants'
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    document_id: Mapped[str] = mapped_column(ForeignKey('edit_documents.id', ondelete='RESTRICT'), index=True)
    document_revision: Mapped[int]
    kind: Mapped[str] = mapped_column(default='edit', index=True)
    name: Mapped[str]
    file_path: Mapped[str]
    file_hash: Mapped[str] = mapped_column(index=True)
    width: Mapped[int]
    height: Mapped[int]
    recipe: Mapped[dict] = mapped_column(JSON)
    source_json: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[str] = mapped_column(default=now, index=True)

class DetectedFace(Base):
    __tablename__ = 'detected_faces'
    id: Mapped[str] = mapped_column(primary_key=True,default=uid)
    photo_id: Mapped[str] = mapped_column(ForeignKey('photos.id',ondelete='CASCADE'),index=True)
    person_id: Mapped[str | None] = mapped_column(ForeignKey('face_persons.id',ondelete='SET NULL'),index=True)
    face_index: Mapped[int]
    encoding: Mapped[bytes]
    location: Mapped[dict] = mapped_column(JSON)
    confirmed: Mapped[bool] = mapped_column(default=False,index=True)
    model_space: Mapped[str] = mapped_column(ForeignKey('face_model_spaces.id',ondelete='RESTRICT'),default=LEGACY_SPACE,server_default=LEGACY_SPACE,index=True)

Index('ix_photo_date_lens', Photo.date_taken, Photo.lens_model)
Index('ix_face_ignore_source_space',FaceIgnoredMember.source_hash,FaceIgnoredMember.model_space)
engine = create_engine(f'sqlite:///{DATA / "library.db"}', connect_args={'check_same_thread': False, 'timeout': 30})

@event.listens_for(engine, 'connect')
def sqlite_options(connection, _record) -> None:
    from .services.text_search import clean,contains
    connection.create_function('pc_text_clean',1,clean,deterministic=True)
    connection.create_function('pc_text_contains',2,contains,deterministic=True)
    connection.execute('PRAGMA foreign_keys=ON')
    connection.execute('PRAGMA journal_mode=WAL')
    connection.execute('PRAGMA busy_timeout=30000')

class LibrarySession(OrmSession):
    pass


@event.listens_for(LibrarySession,'do_orm_execute')
def hide_removed_records(state):
    # Archive metadata remains in the same relations. Ordinary ORM queries,
    # including aliases/subqueries used by statistics, only see active photos.
    # Restore/maintenance explicitly opt in, never via a browser query flag.
    if state.is_select and not state.execution_options.get('include_removed',False):
        state.statement=state.statement.options(with_loader_criteria(Photo,lambda row:row.removed_at.is_(None),include_aliases=True))


Session = sessionmaker(engine, expire_on_commit=False,class_=LibrarySession)

def initialize(target_engine=None) -> None:
    from .migrations import migrate_database, SCHEMA_VERSION
    selected=target_engine if target_engine is not None else engine
    migrate_database(Path(selected.url.database))
    Base.metadata.create_all(selected)
    for table in Base.metadata.tables.values():
        for index in table.indexes:
            index.create(selected,checkfirst=True)
    # Fresh databases do not pass through a migration before create_all.
    # Stamp them too, so schema-aware tools can reject unsupported versions.
    with selected.begin() as connection:
        connection.exec_driver_sql('INSERT OR IGNORE INTO face_model_spaces VALUES (?,?,?,?)', (LEGACY_SPACE,'{}',False,now()))
        connection.exec_driver_sql('INSERT OR IGNORE INTO library_profile VALUES (1,?,?,?)', (uid(), now(), '{}'))
        connection.exec_driver_sql(f'PRAGMA user_version={SCHEMA_VERSION}')
    from .services.text_index import initialize as initialize_text_index
    initialize_text_index(selected)
    from .services.location_index import initialize as initialize_location_index
    initialize_location_index(selected)

