import hashlib
import os
from contextlib import nullcontext
from datetime import datetime
from pathlib import Path
from time import monotonic
from PIL import Image
from sqlalchemy import select,text
from ..config import DATA, EXPORTS, MODELS, EXTENSIONS, RAW_EXTENSIONS, SCAN_PATHS
from ..models import Session, Photo, CaptureGroup, PhotoTag, uid
from . import jobs, metadata_service, exiftool_service, thumbnail_service, raw_preview_service

EXIF_FIELDS = ['date_taken', 'camera_make', 'camera_model', 'lens_model', 'f_number',
               'exposure_time', 'exposure_seconds', 'iso', 'focal_length', 'focal_length_35mm',
               'gps_latitude', 'gps_longitude']
PREVIEW_BATCH_SIZE=100
FIRST_PREVIEW_BATCH_SIZE=24
PREVIEW_BATCH_SECONDS=8

def file_hash(path: Path, job_id=None) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            if job_id:jobs.check(job_id)
            digest.update(chunk)
    return digest.hexdigest()

def pair_candidate(session, photo: Photo) -> Photo | None:
    if not photo.is_raw and photo.file_format.upper() not in ('JPG','JPEG'):
        return None
    candidates = session.scalars(select(Photo).where(Photo.is_raw != photo.is_raw,
        Photo.file_stem == photo.file_stem, Photo.source_directory == photo.source_directory)).all()
    matches = []
    target = Path(photo.file_path)
    for other in candidates:
        if not other.is_raw and other.file_format.upper() not in ('JPG','JPEG'):
            continue
        source = Path(other.file_path)
        if source.parent != target.parent or source.stem.casefold() != target.stem.casefold():
            continue
        if other.camera_model and photo.camera_model and other.camera_model != photo.camera_model:
            continue
        if other.date_taken and photo.date_taken:
            try:delta = abs((datetime.fromisoformat(other.date_taken) - datetime.fromisoformat(photo.date_taken)).total_seconds())
            except (ValueError,TypeError):continue
            if delta > 2:
                continue
        members = session.scalars(select(Photo).where(Photo.capture_group_id == other.capture_group_id)).all()
        if len(members) == 1:
            matches.append(other)
    # Ambiguous bursts or duplicate stems never get paired by time alone.
    return matches[0] if len(matches) == 1 else None

def import_one(path: Path, *, defer_previews=False, job_id=None, metadata_supplement=None, automatic=False) -> tuple[str, str]:
    path = path.resolve(strict=True)
    digest = file_hash(path,job_id)
    with Session() as session:
        if automatic:
            # A removal cannot slip between the tombstone check and registration.
            # Automatic scans always defer rendering until after this transaction.
            session.execute(text('BEGIN IMMEDIATE'))
            tombstones=session.execute(select(Photo.id,Photo.removed_original_path).where(Photo.removed_at.is_not(None),Photo.source_directory==str(path.parent).casefold()).execution_options(include_removed=True))
            for removed in tombstones:
                if removed.removed_original_path and os.path.normcase(os.path.abspath(removed.removed_original_path))==os.path.normcase(str(path)):
                    return 'skipped',removed.id
        existing = session.scalar(select(Photo).where(Photo.file_hash == digest).execution_options(include_removed=True))
        if existing:
            if existing.removed_at:return 'skipped',existing.id
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
        metadata = metadata_service.extract(path,metadata_supplement,digest)
        from .rating_service import external_rating
        metadata.update(external_rating(metadata['raw_exif']))
        if job_id:jobs.check(job_id)
        if file_hash(path,job_id)!=digest:raise ValueError('原片内容已变化，请重新定位或重新导入')
        if defer_previews and path.suffix.lower() not in RAW_EXTENSIONS:
            # Validate the container without a full RGB decode/resize on the indexing path.
            with Image.open(path) as image:image.verify()
            if metadata.get('orientation') in (5,6,7,8):metadata['width'],metadata['height']=metadata.get('height'),metadata.get('width')
        elif defer_previews and metadata.get('orientation') in (5,6,7,8):
            metadata['width'],metadata['height']=metadata.get('height'),metadata.get('width')
        photo = Photo(id=uid(), file_path=str(path), file_name=path.name, file_hash=digest,
                      file_stem=path.stem.casefold(), source_directory=str(path.parent).casefold(),
                      file_size=path.stat().st_size, file_format=path.suffix[1:].upper(),
                      is_raw=path.suffix.lower() in RAW_EXTENSIONS, **metadata)
        try:
            for field, value in ({} if defer_previews else thumbnail_service.generate(path, photo.id)).items():
                setattr(photo, field, value)
        except Exception as error:
            if not photo.is_raw:
                raise ValueError(f'无法解码照片：{error}') from error
            photo.preview_error = f'RAW 预览不可用：{error}'
        other = pair_candidate(session, photo)
        if other:
            group = session.get(CaptureGroup, other.capture_group_id)
            photo.capture_group_id = group.id
            photo.favorite=other.favorite;photo.color_label=other.color_label;photo.flag=other.flag
            # Existing app decisions (including cleared stars and unknown legacy
            # provenance) protect the whole paired capture from an import.
            if other.rating_source!='none':photo.rating=other.rating;photo.rating_source=other.rating_source
            else:other.rating=photo.rating;other.rating_source=photo.rating_source
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
        if other:
            session.flush()
            for tag_id in session.scalars(select(PhotoTag.tag_id).where(PhotoTag.photo_id==other.id)):
                session.add(PhotoTag(photo_id=photo.id,tag_id=tag_id))
        session.commit()
        return 'success', photo_id


def needs_preview(photo_id):
    with Session() as session:
        photo=session.get(Photo,photo_id)
        return bool(photo and (not photo.thumbnail_path or not photo.preview_path or photo.preview_error or not Path(photo.thumbnail_path).is_file() or not Path(photo.preview_path).is_file()))


def generate_preview(photo_id, job_id):
    jobs.check(job_id)
    with Session() as session:
        photo=session.get(Photo,photo_id)
        if photo is None:return 'skipped'
        path=Path(photo.file_path);expected=photo.file_hash;is_raw=photo.is_raw
    try:
        before=path.stat()
        if file_hash(path,job_id)!=expected:raise ValueError('原片内容已变化，请重新定位或重新导入')
        prepared=raw_preview_service.prepare(path,job_id) if is_raw else nullcontext(thumbnail_service.generate(path,photo_id))
        with prepared as values:
            after=path.stat()
            if (before.st_size,before.st_mtime_ns)!=(after.st_size,after.st_mtime_ns):raise ValueError('生成预览时原片已变化，请重新导入')
            if is_raw:
                if file_hash(path,job_id)!=expected or path.stat().st_mtime_ns!=before.st_mtime_ns:
                    raise ValueError('生成预览时原片已变化，请重新导入')
                jobs.check(job_id)
            with Session() as session:
                current=session.get(Photo,photo_id)
                if current is None or current.file_hash!=expected or current.file_path!=str(path):return 'skipped'
                if is_raw:
                    for key,folder in [('preview_path','previews'),('thumbnail_path','thumbnails')]:
                        target=(DATA/folder/f'{photo_id}.jpg').resolve()
                        if not target.is_relative_to(DATA.resolve()):raise ValueError('RAW 预览目标无效')
                        # Only derived files are published, after hash/session/record checks.
                        Path(values[key]).replace(target);values[key]=str(target)
                for key,value in values.items():setattr(current,key,value)
                current.preview_error=None
                session.commit()
        return 'success'
    except jobs.JobCancelled:raise
    except Exception as error:
        with Session() as session:
            current=session.get(Photo,photo_id)
            if current is not None and current.file_hash==expected and current.file_path==str(path):
                current.preview_error=f'预览不可用：{error}';session.commit()
        raise

def import_paths(job_id: str, paths: list[str], recursive: bool, exclude_derived: bool = False, collect_ids: bool = False, automatic: bool = False) -> None:
    from . import import_face_analysis
    auto_faces=import_face_analysis.permission();new_photo_ids={}
    files: dict[str, Path] = {}
    errors = []
    failed = 0
    excluded = [(DATA / name).resolve() for name in ('thumbnails', 'watermark_previews', 'previews', 'embeddings', 'exports', 'export-records', 'artworks', 'documents', 'assets', 'ai-studio')]
    excluded.extend([EXPORTS.resolve(), MODELS.resolve()])
    # A source directory may contain caches from a previous library location.
    for root in SCAN_PATHS:
        excluded.extend((Path(root) / name).resolve() for name in ('thumbnails','watermark_previews','previews','embeddings','exports','export-records','imports','backups','artworks','ai-studio'))
        if (Path(root)/'library.db').is_file():
            excluded.extend((Path(root)/name).resolve() for name in ('documents','assets'))
    from .export_registry import registered_files
    generated = registered_files() if exclude_derived else set()
    def derived(path: Path) -> bool:
        if not exclude_derived:
            return False
        resolved = path.resolve()
        return resolved in generated or any(resolved == folder or folder in resolved.parents for folder in excluded)
    parent_id = job_id
    with jobs.stage(parent_id, 'import-scan') as job_id:
        jobs.update(job_id, phase='scanning')
        for value in paths:
            jobs.check(job_id)
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
                    jobs.check(job_id)
                    dirs[:] = [name for name in dirs if not derived(Path(root) / name)]
                    jobs.update(job_id, current=f'扫描目录：{root}', total=len(files))
                    for index, name in enumerate(names):
                        if index % 128 == 0:jobs.check(job_id)
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
        jobs.update(job_id, total=len(files) + failed, success=len(files), failed=failed,
                    processed=len(files)+failed, errors=errors[:100])
    with jobs.stage(parent_id, 'import-index') as job_id, jobs.stage(parent_id,'import-preview',mirror=False,resource='render') as preview_id:
        jobs.update(job_id, phase='processing', total=len(files)+failed, processed=failed,
                    success=0, skipped=0, failed=failed, errors=errors[:100])
        counts = dict(success=0, skipped=0, failed=failed)
        photo_ids = {}
        waiting={};preview_seen=set();preview_counts=dict(success=0,skipped=0,failed=0);preview_total=0;last_batch=monotonic()
        jobs.update(preview_id,status='queued')
        jobs.update(parent_id,active_child_id=job_id)
        def render_batch():
            nonlocal last_batch,preview_total
            if not waiting:return
            batch=list(waiting.items());waiting.clear();preview_total+=len(batch)
            jobs.update(preview_id,status='queued',total=preview_total)
            jobs.update(parent_id,phase='previews',active_child_id=preview_id,preview_total=preview_total)
            for photo_id,name in batch:
                jobs.check(preview_id)
                processed=sum(preview_counts.values())
                jobs.update(preview_id,current=f'生成预览：{processed}/{preview_total} · {name}')
                with jobs.import_render_slot(parent_id,preview_id):
                    try:preview_counts[generate_preview(photo_id,preview_id)]+=1
                    except jobs.JobCancelled:raise
                    except Exception as error:
                        preview_counts['failed']+=1;errors.append(f'{name}：{error}')
                jobs.update(preview_id,processed=sum(preview_counts.values()),**preview_counts)
                jobs.update(parent_id,preview_processed=sum(preview_counts.values()),preview_failed=preview_counts['failed'],errors=errors[:100])
            jobs.update(preview_id,status='queued',current='')
            jobs.update(parent_id,phase='processing',active_child_id=job_id)
            last_batch=monotonic()
        file_list=list(files.values());supplements={}
        for index, path in enumerate(file_list, 1):
            jobs.check(job_id)
            if (index-1)%exiftool_service.BATCH_SIZE==0:
                supplements=exiftool_service.read_batch(file_list[index-1:index-1+exiftool_service.BATCH_SIZE],job_id)
            jobs.update(job_id, current=str(path))
            try:
                status, photo_id = import_one(path,defer_previews=True,job_id=job_id,metadata_supplement=supplements.get(path.resolve()),automatic=automatic)
                counts[status] += 1
                if status=='success':
                    new_photo_ids[photo_id]=None
                    # A review suggestion only: no cloud work is scheduled here.
                    jobs.update(parent_id,new_photo_ids=list(new_photo_ids)[:10000])
                if photo_id not in preview_seen and needs_preview(photo_id):waiting[photo_id]=path.name;preview_seen.add(photo_id)
                if collect_ids:
                    photo_ids[photo_id] = None
            except jobs.JobCancelled:raise
            except Exception as error:
                counts['failed'] += 1
                errors.append(f'{path.name}：{error}')
            jobs.update(job_id, processed=sum(counts.values()), errors=errors[:100],
                        **({'photo_ids': list(photo_ids)} if collect_ids else {}), **counts)
            batch_size=PREVIEW_BATCH_SIZE if preview_total else FIRST_PREVIEW_BATCH_SIZE
            if len(waiting)>=batch_size or monotonic()-last_batch>=PREVIEW_BATCH_SECONDS:render_batch()
        jobs.update(job_id,status='completed',current='')
        render_batch()
    from .embedding_service import service
    service.index_if_ready()
    import_face_analysis.queue_after_import(parent_id,new_photo_ids,auto_faces)
