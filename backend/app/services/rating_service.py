"""Read external stars without writing photographs or replacing an app decision."""
from pathlib import Path
from fastapi import HTTPException
from sqlalchemy import text
from ..models import Session,Photo,now
from . import metadata_service,library_service


def xmp_rating(value):
    if isinstance(value,str):
        value=value.strip()
        return int(value) if len(value)==1 and value in '012345' else None
    return int(value) if not isinstance(value,bool) and isinstance(value,(int,float)) and value in range(6) else None


def external_rating(raw):
    for key,source in [('xmp-sidecar:XMP-xmp:Rating','xmp-sidecar'),('xmp-embedded:XMP-xmp:Rating','xmp-embedded'),('exiftool:XMP-xmp:Rating','xmp-embedded')]:
        value=xmp_rating(raw.get(key))
        if value is not None:return dict(rating=value,rating_source=source)
    return dict(rating=None,rating_source='none')


def refresh(photo_id):
    from .import_service import file_hash
    with Session() as session:
        photo=session.get(Photo,photo_id)
        if not photo:raise HTTPException(404,'照片不存在')
        path=Path(photo.file_path);digest=photo.file_hash;previous=(photo.rating,photo.rating_source)
    # No database transaction or image decode is kept open while reading the file.
    if not path.is_file():raise ValueError('原片不可用，请重新连接后刷新评分')
    if file_hash(path)!=digest:raise ValueError('原片内容已变化，未刷新评分')
    external=external_rating(metadata_service.extract(path,source_hash=digest)['raw_exif'])
    if file_hash(path)!=digest:raise ValueError('原片内容已变化，未刷新评分')
    with Session() as session:
        session.execute(text('BEGIN IMMEDIATE'))
        photo=session.get(Photo,photo_id)
        if not photo:raise HTTPException(404,'照片不存在')
        if photo.file_hash!=digest or photo.file_path!=str(path):raise ValueError('原片内容已变化，未刷新评分')
        if photo.rating_source in ('manual','legacy'):status='protected'
        elif (photo.rating,photo.rating_source)!=previous:status='changed'
        elif external['rating'] is None:status='not_found'
        else:
            photo.rating=external['rating'];photo.rating_source=external['rating_source'];photo.updated_at=now();status='updated'
        session.commit()
        return dict(status=status,external=external,photo=library_service.serialize(session,[photo],True)[0])
