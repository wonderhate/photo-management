from datetime import datetime, timezone
from uuid import uuid4
from sqlalchemy import String, ForeignKey, JSON, Index, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
from .config import DATA

def uid() -> str:
    return str(uuid4())

def now() -> str:
    return datetime.now(timezone.utc).isoformat()

class Base(DeclarativeBase):
    pass

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
    color_label: Mapped[str | None] = mapped_column(index=True)
    face_data: Mapped[dict | None] = mapped_column(JSON, default=dict)
    created_at: Mapped[str] = mapped_column(default=now)
    updated_at: Mapped[str] = mapped_column(default=now, onupdate=now)

class Album(Base):
    __tablename__ = 'albums'
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    name: Mapped[str]
    person_id: Mapped[str | None] = mapped_column(ForeignKey('face_persons.id', ondelete='SET NULL'), index=True)
    type: Mapped[str] = mapped_column(default='normal')
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

class Tag(Base):
    __tablename__ = 'tags'
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(unique=True)

class PhotoTag(Base):
    __tablename__ = 'photo_tags'
    photo_id: Mapped[str] = mapped_column(ForeignKey('photos.id', ondelete='CASCADE'), primary_key=True)
    tag_id: Mapped[str] = mapped_column(ForeignKey('tags.id', ondelete='CASCADE'), primary_key=True)

class Embedding(Base):
    __tablename__ = 'embeddings'
    photo_id: Mapped[str] = mapped_column(ForeignKey('photos.id', ondelete='CASCADE'), primary_key=True)
    model: Mapped[str] = mapped_column(primary_key=True)
    embedding_path: Mapped[str]
    created_at: Mapped[str] = mapped_column(default=now)

class FacePerson(Base):
    __tablename__ = 'face_persons'
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(unique=True)
    representative_encoding: Mapped[bytes | None]
    photo_count: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[str] = mapped_column(default=now)
    updated_at: Mapped[str] = mapped_column(default=now, onupdate=now)

class JobRecord(Base):
    __tablename__ = 'jobs'
    id: Mapped[str] = mapped_column(primary_key=True)
    payload: Mapped[dict] = mapped_column(JSON)
    updated_at: Mapped[str] = mapped_column(default=now,index=True)

class DetectedFace(Base):
    __tablename__ = 'detected_faces'
    id: Mapped[str] = mapped_column(primary_key=True,default=uid)
    photo_id: Mapped[str] = mapped_column(ForeignKey('photos.id',ondelete='CASCADE'),index=True)
    person_id: Mapped[str | None] = mapped_column(ForeignKey('face_persons.id',ondelete='SET NULL'),index=True)
    face_index: Mapped[int]
    encoding: Mapped[bytes]
    location: Mapped[dict] = mapped_column(JSON)
    confirmed: Mapped[bool] = mapped_column(default=False,index=True)

Index('ix_photo_date_lens', Photo.date_taken, Photo.lens_model)
engine = create_engine(f'sqlite:///{DATA / "library.db"}', connect_args={'check_same_thread': False, 'timeout': 30})

@event.listens_for(engine, 'connect')
def sqlite_options(connection, _record) -> None:
    connection.execute('PRAGMA foreign_keys=ON')
    connection.execute('PRAGMA journal_mode=WAL')
    connection.execute('PRAGMA busy_timeout=30000')

Session = sessionmaker(engine, expire_on_commit=False)

def initialize() -> None:
    from .migrations import migrate_database
    migrate_database(DATA / 'library.db')
    Base.metadata.create_all(engine)
    for table in Base.metadata.tables.values():
        for index in table.indexes:
            index.create(engine,checkfirst=True)

