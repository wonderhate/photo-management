"""Capture-based album metadata, bounded covers, and relation-only removal."""
from sqlalchemy import select,func,delete,literal
from ..models import Album,AlbumPhoto,Photo,CaptureGroup,LibraryProfile
from . import library_service


def members(album_ids):
    # One row per capture, including imports whose chosen member is a RAW file.
    groups=select(AlbumPhoto.album_id.label('aid'),Photo.capture_group_id.label('gid'),
        func.min(AlbumPhoto.position).label('position'),func.max(AlbumPhoto.added_at).label('added_at')).join(
        Photo,Photo.id==AlbumPhoto.photo_id).where(AlbumPhoto.album_id.in_(album_ids)).group_by(
        AlbumPhoto.album_id,Photo.capture_group_id).subquery()
    return select(groups.c.aid,Photo.id.label('pid'),Photo.date_taken.label('date_taken'),
        groups.c.position,groups.c.added_at).join_from(groups,CaptureGroup,CaptureGroup.id==groups.c.gid).join(
        Photo,Photo.id==CaptureGroup.preferred_photo_id).subquery()


def summaries(session,albums):
    if not albums:return []
    stats={};covers={};recent={}
    normal=[a.id for a in albums if a.type!='rule']
    if normal:
        data=members(normal)
        for aid,count,first,last,added,unknown in session.execute(select(data.c.aid,func.count(),func.min(data.c.date_taken),
            func.max(data.c.date_taken),func.max(data.c.added_at),func.count()-func.count(data.c.date_taken)).group_by(data.c.aid)):
            stats[aid]=dict(count=count,date_from=first,date_to=last,last_added_at=added,last_imported_at=None,unknown_date_count=unknown)
        def sample(order,known=False):
            ranked=select(data.c.aid,data.c.pid,func.row_number().over(partition_by=data.c.aid,order_by=order).label('rank'))
            if known:ranked=ranked.where(data.c.added_at.is_not(None))
            ranked=ranked.subquery();result={}
            for aid,pid in session.execute(select(ranked.c.aid,ranked.c.pid).where(ranked.c.rank<=4).order_by(ranked.c.aid,ranked.c.rank)):
                result.setdefault(aid,[]).append(pid)
            return result
        covers=sample([data.c.position,data.c.pid]);recent=sample([data.c.added_at.desc(),data.c.pid],True)
    for a in albums:
        if a.type!='rule':continue
        q=library_service.query_photos({'query':a.query}).subquery()
        count,first,last,imported,unknown=session.execute(select(func.count(),func.min(q.c.date_taken),func.max(q.c.date_taken),
            func.max(q.c.created_at),func.count()-func.count(q.c.date_taken))).one()
        stats[a.id]=dict(count=count,date_from=first,date_to=last,last_added_at=None,last_imported_at=imported,unknown_date_count=unknown or 0)
        covers[a.id]=list(session.scalars(select(q.c.id).order_by(q.c.date_taken.desc(),q.c.id).limit(4)))
        recent[a.id]=list(session.scalars(select(q.c.id).order_by(q.c.created_at.desc(),q.c.id).limit(4)))
    manual={a.cover_photo_id for a in albums if a.cover_photo_id}
    available=set(session.scalars(select(Photo.id).where(Photo.id.in_(manual)))) if manual else set()
    result=[]
    for a in albums:
        row={c.name:getattr(a,c.name) for c in Album.__table__.columns}
        row.update(stats.get(a.id,dict(count=0,date_from=None,date_to=None,last_added_at=None,last_imported_at=None,unknown_date_count=0)))
        is_manual=bool(a.cover_photo_id)
        images=([a.cover_photo_id] if a.cover_photo_id in available else []) if is_manual else covers.get(a.id,[])
        row.update(cover_id=images[0] if images else None,cover_ids=images,cover_mode='manual' if is_manual else 'auto',
            cover_missing=is_manual and a.cover_photo_id not in available,recent_photo_ids=recent.get(a.id,[]),recent_kind='imported' if a.type=='rule' else 'joined')
        result.append(row)
    return result


def recent_photos(session,album,page=1,page_size=24):
    if album.type=='rule':
        q=library_service.query_photos({'query':album.query});order=[Photo.created_at.desc(),Photo.id];added_column=literal(None)
    else:
        data=members([album.id]);q=select(Photo).join(data,data.c.pid==Photo.id)
        order=[data.c.added_at.is_(None),data.c.added_at.desc(),data.c.position,Photo.id]
        added_column=data.c.added_at
    total=session.scalar(select(func.count()).select_from(q.subquery()))
    window=session.execute(q.add_columns(added_column).order_by(*order).offset((page-1)*page_size).limit(page_size)).all()
    photos=[p for p,_ in window];added={p.id:value for p,value in window}
    # Metadata is hydrated only for this window, never for the cover aggregates.
    records=library_service.serialize(session,photos)
    for row in records:row['album_added_at']=added.get(row['id'])
    return dict(photos=records,total=total,recent_kind='imported' if album.type=='rule' else 'joined')


def remove(session,ids):
    wanted=set(ids);found=set(session.scalars(select(Album.id).where(Album.id.in_(wanted))))
    if wanted!=found:raise ValueError('部分影集已不存在，请刷新列表')
    # Never touch Photo, capture groups, people, artwork files or originals.
    session.execute(delete(AlbumPhoto).where(AlbumPhoto.album_id.in_(wanted)))
    session.execute(delete(Album).where(Album.id.in_(wanted)))
    profile=session.get(LibraryProfile,1)
    prefs=profile.preferences or {};view=prefs.get('albums',{})
    if 'order' in view:profile.preferences={**prefs,'albums':{**view,'order':[i for i in view['order'] if i not in wanted]}}
    session.commit();return dict(deleted=len(wanted),originals_untouched=True)
