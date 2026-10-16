import hashlib
import os
from datetime import datetime
from pathlib import Path
from sqlalchemy import select
from ..config import DATA, EXPORTS, MODELS, EXTENSIONS, RAW_EXTENSIONS, SCAN_PATHS
from ..models import Session, Photo, CaptureGroup, uid
from . import jobs, exif_service, thumbnail_service

EXIF_FIELDS = ['date_taken', 'camera_make', 'camera_model', 'lens_model', 'f_number',
               'exposure_time', 'exposure_seconds', 'iso', 'focal_length', 'focal_length_35mm',
               'gps_latitude', 'gps_longitude']

def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()

def pair_candidate(session, photo: Photo) -> Photo | None:
    candidates = session.scalars(select(Photo).where(Photo.is_raw != photo.is_raw,
        Photo.file_stem == photo.file_stem, Photo.source_directory == photo.source_directory)).all()
    matches = []
    target = Path(photo.file_path)
    for other in candidates:
        source = Path(other.file_path)
        if source.parent != target.parent or source.stem.casefold() != target.stem.casefold():
            continue
        if other.camera_model and photo.camera_model and other.camera_model != photo.camera_model:
            continue
        if other.date_taken and photo.date_taken:
            delta = abs((datetime.fromisoformat(other.date_taken) - datetime.fromisoformat(photo.date_taken)).total_seconds())
            if delta > 2:
                continue
        members = session.scalars(select(Photo).where(Photo.capture_group_id == other.capture_group_id)).all()
        if len(members) == 1:
            matches.append(other)
    # Ambiguous bursts or duplicate stems never get paired by time alone.
    return matches[0] if len(matches) == 1 else None

def import_one(path: Path) -> tuple[str, str]:
    path = path.resolve(strict=True)
    digest = file_hash(path)
    with Session() as session:
        existing = session.scalar(select(Photo).where(Photo.file_hash == digest))
        if existing:
            if not Path(existing.file_path).exists():
                existing.file_path = str(path)
                existing.file_name = path.name
                existing.file_stem = path.stem.casefold()
                existing.source_directory = str(path.parent).casefold()
                session.commit()
            return 'skipped', existing.id
        existing_path = session.scalar(select(Photo).where(Photo.file_path == str(path)))
        if existing_path:
            raise ValueError('此路径的内容已改变；请先移出旧记录再导入')
        metadata = exif_service.extract(path)
        photo = Photo(id=uid(), file_path=str(path), file_name=path.name, file_hash=digest,
                      file_stem=path.stem.casefold(), source_directory=str(path.parent).casefold(),
                      file_size=path.stat().st_size, file_format=path.suffix[1:].upper(),
                      is_raw=path.suffix.lower() in RAW_EXTENSIONS, **metadata)
        try:
            for field, value in thumbnail_service.generate(path, photo.id).items():
                if photo.is_raw and field in ('width', 'height') and metadata.get(field):
                    source_field = ('height' if field == 'width' else 'width') if metadata.get('orientation') in (5,6,7,8) else field
                    value = metadata.get(source_field) or value
                setattr(photo, field, value)
        except Exception as error:
            if not photo.is_raw:
                raise ValueError(f'无法解码照片：{error}') from error
            photo.preview_error = f'RAW 预览不可用：{error}'
        other = pair_candidate(session, photo)
        if other:
            group = session.get(CaptureGroup, other.capture_group_id)
            photo.capture_group_id = group.id
            raw = photo if photo.is_raw else other
            jpeg = other if photo.is_raw else photo
            for field in EXIF_FIELDS:
                value = getattr(raw, field)
                if value is not None:
                    setattr(jpeg, field, value)
                elif getattr(jpeg, field) is not None:
                    setattr(raw, field, getattr(jpeg, field))
            group.preferred_photo_id = jpeg.id
            group.date_taken = jpeg.date_taken
            group.camera_model = jpeg.camera_model
        else:
            group = CaptureGroup(id=uid(), preferred_photo_id=photo.id, date_taken=photo.date_taken, camera_model=photo.camera_model)
            session.add(group)
            session.flush()
            photo.capture_group_id = group.id
        session.add(photo)
        photo_id = photo.id
        session.commit()
        return 'success', photo_id

def import_paths(job_id: str, paths: list[str], recursive: bool, exclude_derived: bool = False, collect_ids: bool = False) -> None:
    files: dict[str, Path] = {}
    errors = []
    failed = 0
    excluded = [(DATA / name).resolve() for name in ('thumbnails', 'watermark_previews', 'previews', 'embeddings', 'exports', 'export-records', 'artworks')]
    excluded.extend([EXPORTS.resolve(), MODELS.resolve()])
    # A source directory may contain caches from a previous library location.
    for root in SCAN_PATHS:
        excluded.extend((Path(root) / name).resolve() for name in ('thumbnails','watermark_previews','previews','embeddings','exports','export-records','imports','backups','artworks'))
    from .export_registry import registered_files
    generated = registered_files() if exclude_derived else set()
    def derived(path: Path) -> bool:
        if not exclude_derived:
            return False
        resolved = path.resolve()
        return resolved in generated or any(resolved == folder or folder in resolved.parents for folder in excluded)
    for value in paths:
        path = Path(value).expanduser()
        if not path.is_absolute():
            errors.append(f'{value}：请使用绝对路径')
            failed += 1
            continue
        if not path.exists():
            errors.append(f'{path}：文件或目录不存在')
            failed += 1
            continue
        if derived(path):
            continue
        if path.is_dir():
            def on_error(error: OSError) -> None:
                errors.append(str(error))
            for root, dirs, names in os.walk(path, onerror=on_error, followlinks=False):
                dirs[:] = [name for name in dirs if not derived(Path(root) / name)]
                jobs.update(job_id, current=f'扫描目录：{root}', total=len(files))
                for name in names:
                    child = Path(root) / name
                    if child.suffix.lower() in EXTENSIONS and not derived(child):
                        files[str(child.resolve()).casefold()] = child
                if not recursive:
                    dirs.clear()
        elif path.suffix.lower() in EXTENSIONS:
            files[str(path.resolve()).casefold()] = path
        else:
            failed += 1
            errors.append(f'{path.name}：不支持的格式')
    jobs.update(job_id, total=len(files) + failed, failed=failed, processed=failed, errors=errors[:100])
    counts = dict(success=0, skipped=0, failed=failed)
    photo_ids = {}
    for index, path in enumerate(files.values(), 1):
        jobs.check(job_id)
        jobs.update(job_id, current=str(path))
        try:
            status, photo_id = import_one(path)
            counts[status] += 1
            if collect_ids:
                photo_ids[photo_id] = None
        except Exception as error:
            counts['failed'] += 1
            errors.append(f'{path.name}：{error}')
        jobs.update(job_id, processed=sum(counts.values()), errors=errors[:100],
                    **({'photo_ids': list(photo_ids)} if collect_ids else {}), **counts)
    from .embedding_service import service
    service.index_if_ready()
