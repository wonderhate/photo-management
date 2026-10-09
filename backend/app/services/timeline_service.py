from datetime import datetime
from sqlalchemy import func, extract
from ..models import Session, Photo

def get_timeline_hierarchy() -> dict:
    session = Session()
    try:
        photos_with_dates = session.query(
            func.substr(Photo.date_taken, 1, 4).label('year'),
            func.substr(Photo.date_taken, 6, 2).label('month'),
            func.substr(Photo.date_taken, 9, 2).label('day'),
            func.count(Photo.id).label('count')
        ).filter(
            Photo.date_taken.isnot(None)
        ).group_by(
            func.substr(Photo.date_taken, 1, 4),
            func.substr(Photo.date_taken, 6, 2),
            func.substr(Photo.date_taken, 9, 2)
        ).order_by(
            func.substr(Photo.date_taken, 1, 4).desc(),
            func.substr(Photo.date_taken, 6, 2).desc(),
            func.substr(Photo.date_taken, 9, 2).desc()
        ).all()

        hierarchy = {}
        for row in photos_with_dates:
            year = row.year or '未知'
            month = row.month or '00'
            day = row.day or '00'
            if year not in hierarchy:
                hierarchy[year] = {'months': {}, 'total': 0}
            if month not in hierarchy[year]['months']:
                hierarchy[year]['months'][month] = {'days': {}, 'total': 0}
            hierarchy[year]['months'][month]['days'][day] = row.count
            hierarchy[year]['months'][month]['total'] += row.count
            hierarchy[year]['total'] += row.count

        return {'years': hierarchy}
    finally:
        session.close()

def get_photos_by_date(year: str, month: str | None = None, day: str | None = None) -> list[str]:
    session = Session()
    try:
        query = session.query(Photo.id).filter(Photo.date_taken.isnot(None))
        if year and year != '未知':
            query = query.filter(func.substr(Photo.date_taken, 1, 4) == year)
        if month:
            query = query.filter(func.substr(Photo.date_taken, 6, 2) == month)
        if day:
            query = query.filter(func.substr(Photo.date_taken, 9, 2) == day)
        return [row[0] for row in query.all()]
    finally:
        session.close()

def get_calendar_heatmap(year: str) -> dict:
    session = Session()
    try:
        daily_counts = session.query(
            func.substr(Photo.date_taken, 1, 10).label('date'),
            func.count(Photo.id).label('count')
        ).filter(
            Photo.date_taken.isnot(None),
            func.substr(Photo.date_taken, 1, 4) == year
        ).group_by(
            func.substr(Photo.date_taken, 1, 10)
        ).all()

        return {date: count for date, count in daily_counts}
    finally:
        session.close()
