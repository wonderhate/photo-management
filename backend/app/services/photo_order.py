"""One SQL ordering contract for photo pages and ID-only gallery queries."""
from sqlalchemy import select, func
from ..models import Photo, AlbumPhoto, Album, Session


def ordered(query, sort: str, direction: str, album_id: str | None = None):
    if sort=='manual' and album_id:
        with Session() as session:
            if session.scalar(select(Album.type).where(Album.id==album_id))=='rule':sort='date_taken'
    if sort == 'manual' and album_id:
        positions = select(Photo.capture_group_id.label('gid'), func.min(AlbumPhoto.position).label('pos')).join(
            AlbumPhoto, AlbumPhoto.photo_id == Photo.id).where(AlbumPhoto.album_id == album_id).group_by(Photo.capture_group_id).subquery()
        return query.join(positions, positions.c.gid == Photo.capture_group_id).order_by(positions.c.pos, Photo.id)
    column = {'date_taken': Photo.date_taken, 'created_at': Photo.created_at,
              'file_name': Photo.file_name, 'rating': Photo.rating}.get(sort, Photo.date_taken)
    # A missing value is always last; a known zero-star rating remains a real value.
    return query.order_by(column.is_(None).asc(), column.asc() if direction == 'asc' else column.desc(), Photo.id)
