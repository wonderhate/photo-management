from calendar import monthrange
from datetime import date
from sqlalchemy import func, select, or_
from ..models import Session, Photo
from .library_service import query_photos, serialize
from .analysis_scope import period


def known_date(column):
    day=func.substr(column,1,10)
    return (func.length(day)==10) & (func.substr(day,1,4)!='0000') & (func.date(day,'+0 days')==day)


def date_filter(year: int, month: int | None = None, day: int | None = None) -> dict:
    start = date(year, month or 1, day or 1)
    end = start if day else date(year, month, monthrange(year, month)[1]) if month else date(year,12,31)
    return {'date_from': start.isoformat(), 'date_to': end.isoformat()}


def daily_counts(count_mode: str = 'capture', filters: dict | None = None) -> list:
    source = query_photos(filters or {}, count_mode).where(known_date(Photo.date_taken)).subquery()
    day = func.substr(source.c.date_taken, 1, 10)
    with Session() as session:
        return session.execute(select(day,func.count()).select_from(source).group_by(day).order_by(day.desc())).all()


def get_timeline_hierarchy(count_mode: str = 'capture', filters: dict | None = None) -> dict:
    years = {}
    known = 0
    for day, count in daily_counts(count_mode, filters):
        if not day: continue
        year, month, date_day = day.split('-')
        y = years.setdefault(year, {'months':{},'total':0})
        m = y['months'].setdefault(month, {'days':{},'total':0})
        m['days'][date_day] = count
        m['total'] += count
        y['total'] += count
        known += count
    q = query_photos(filters or {}, count_mode)
    with Session() as session:
        unknown = session.scalar(select(func.count()).select_from(q.where(func.coalesce(known_date(Photo.date_taken),False)==False).subquery()))
    return {'years':years, 'unknown_date':unknown, 'total':known+unknown,
            'count_mode':q.get_execution_options()['pc_count_mode']}


def date_photos(year: int, month: int | None = None, day: int | None = None, *, page: int = 1, page_size: int = 80, count_mode: str = 'capture', filters: dict | None = None) -> dict:
    if page < 1 or not 1 <= page_size <= 200:
        raise ValueError('页码或分页大小不合法')
    dates = date_filter(year,month,day)
    filters = period(filters or {}, dates['date_from'], dates['date_to'])
    q = query_photos(filters,count_mode).where(known_date(Photo.date_taken))
    return photo_page(q, filters, page, page_size)


def photo_page(q, filters, page, page_size):
    if page < 1 or not 1 <= page_size <= 200:
        raise ValueError('页码或分页大小不合法')
    with Session() as session:
        total = session.scalar(select(func.count()).select_from(q.subquery()))
        photos = session.scalars(q.order_by(Photo.date_taken.desc(),Photo.id).offset((page-1)*page_size).limit(page_size)).all()
        return {'photos':serialize(session,photos),'total':total,'page':page,'page_size':page_size,'filters':filters,
                'count_mode':q.get_execution_options()['pc_count_mode']}


def unknown_photos(*, count_mode='capture', filters=None, page=1, page_size=80):
    q = query_photos(filters or {},count_mode).where(func.coalesce(known_date(Photo.date_taken),False)==False)
    return photo_page(q,filters or {},page,page_size)


def get_calendar_heatmap(year: int, count_mode: str = 'capture', filters: dict | None = None) -> dict:
    dates = date_filter(year)
    return dict(daily_counts(count_mode,period(filters or {},dates['date_from'],dates['date_to'])))
