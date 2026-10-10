from pathlib import Path
from sqlalchemy import select, func, exists, delete
from ..models import Session, Photo, CaptureGroup, PhotoTag, Tag, AlbumPhoto, Embedding, now

def query_photos(filters: dict, count_mode: str = 'capture'):
    q = select(Photo)
    if count_mode == 'capture':
        q = q.join(CaptureGroup, CaptureGroup.preferred_photo_id == Photo.id)
    for key in ('camera_model', 'lens_model'):
        if filters.get(key):
            q = q.where(getattr(Photo, key) == filters[key])
    if filters.get('search'):
        q = q.where(Photo.file_name.contains(filters['search'], autoescape=True))
    if filters.get('semantic'):
        from .embedding_service import service
        matches = service.search([filters['semantic']], 'any', float(filters.get('semantic_threshold', .25)), 50000)
        matched_groups = select(Photo.capture_group_id).where(Photo.id.in_([row['photo_id'] for row in matches]))
        q = q.where(Photo.capture_group_id.in_(matched_groups))
    if filters.get('favorite') in (True, 'true', '1'):
        q = q.where(Photo.favorite.is_(True))
    if filters.get('rating'):
        q = q.where(Photo.rating == int(filters['rating']))
    if filters.get('color_label'):
        q = q.where(Photo.color_label == filters['color_label'])
    if filters.get('date_from'):
        q = q.where(Photo.date_taken >= filters['date_from'])
    if filters.get('date_to'):
        q = q.where(Photo.date_taken <= str(filters['date_to'])[:10] + 'T23:59:59')
    for field in ('focal_length', 'f_number', 'iso', 'exposure_seconds'):
        for suffix, operator in [('', 'eq'), ('_min', 'ge'), ('_max', 'le'), ('_lt', 'lt'), ('_gt', 'gt')]:
            value = filters.get(field + suffix)
            if value is not None and str(value) != '':
                q = q.where(getattr(getattr(Photo, field), '__' + operator + '__')(float(value)))
    if filters.get('orientation') == 'landscape':
        q = q.where(Photo.width > Photo.height)
    if filters.get('orientation') == 'portrait':
        q = q.where(Photo.width < Photo.height)
    if filters.get('orientation') == 'square':
        q = q.where(Photo.width == Photo.height)
    if filters.get('album_id'):
        member_groups = select(Photo.capture_group_id).join(AlbumPhoto, AlbumPhoto.photo_id == Photo.id).where(AlbumPhoto.album_id == filters['album_id'])
        q = q.where(Photo.capture_group_id.in_(member_groups))
    if filters.get('tag'):
        q = q.where(Photo.id.in_(select(PhotoTag.photo_id).join(Tag).where(Tag.name == filters['tag'])))
    kind = filters.get('file_type')
    if kind:
        raw_groups = select(Photo.capture_group_id).where(Photo.is_raw.is_(True))
        jpeg_groups = select(Photo.capture_group_id).where(Photo.is_raw.is_(False))
        if kind in ('raw', 'paired', 'raw_only'):
            q = q.where(Photo.capture_group_id.in_(raw_groups))
        if kind in ('jpeg', 'paired', 'jpeg_only'):
            q = q.where(Photo.capture_group_id.in_(jpeg_groups))
        if kind == 'raw_only':
            q = q.where(Photo.capture_group_id.not_in(jpeg_groups))
        if kind == 'jpeg_only':
            q = q.where(Photo.capture_group_id.not_in(raw_groups))
    return q

def serialize(session, photos: list[Photo], detail: bool = False) -> list[dict]:
    if not photos:
        return []
    ids = [p.id for p in photos]
    groups = {p.capture_group_id for p in photos}
    members: dict[str, list] = {}
    for p in session.scalars(select(Photo).where(Photo.capture_group_id.in_(groups))):
        members.setdefault(p.capture_group_id, []).append({
            'id': p.id, 'file_name': p.file_name, 'file_format': p.file_format, 'is_raw': p.is_raw,
            'file_path': p.file_path, 'preview_available': bool(p.preview_path),
        })
    tags: dict[str, list] = {}
    for photo_id, name in session.execute(select(PhotoTag.photo_id, Tag.name).join(Tag).where(PhotoTag.photo_id.in_(ids))):
        tags.setdefault(photo_id, []).append(name)
    result = []
    for photo in photos:
        record = {c.name: getattr(photo, c.name) for c in Photo.__table__.columns if detail or c.name != 'raw_exif'}
        record.update(tags=tags.get(photo.id, []), files=members.get(photo.capture_group_id, []),
                      thumbnail_url=f'/api/photos/{photo.id}/thumbnail', preview_url=f'/api/photos/{photo.id}/preview')
        if detail:
            record['missing'] = not Path(photo.file_path).is_file()
            from ..models import WatermarkDraft
            record['watermark_draft_count'] = session.scalar(select(func.count()).select_from(WatermarkDraft).where(WatermarkDraft.capture_group_id == photo.capture_group_id))
        result.append(record)
    return result

def remove_photo(session, photo: Photo, whole_capture: bool) -> int:
    group_id = photo.capture_group_id
    targets = session.scalars(select(Photo).where(Photo.capture_group_id == group_id)).all() if whole_capture else [photo]
    for item in targets:
        # Deliberately never unlink originals (including browser-imported files).
        session.delete(item)
    session.flush()
    remaining = session.scalars(select(Photo).where(Photo.capture_group_id == group_id)).all()
    group = session.get(CaptureGroup, group_id)
    if remaining:
        group.preferred_photo_id = sorted(remaining, key=lambda p: (p.is_raw, not p.preview_path))[0].id
    else:
        session.delete(group)
    session.commit()
    return len(targets)

def set_tags(session, photo: Photo, names: list[str]) -> None:
    session.execute(delete(PhotoTag).where(PhotoTag.photo_id == photo.id))
    for name in dict.fromkeys(n.strip()[:100] for n in names if n.strip()):
        tag = session.scalar(select(Tag).where(Tag.name == name))
        if not tag:
            tag = Tag(name=name)
            session.add(tag)
            session.flush()
        session.add(PhotoTag(photo_id=photo.id, tag_id=tag.id))
