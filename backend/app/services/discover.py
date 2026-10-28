"""Date and explicitly named place suggestions; never rewrite homepage choices."""
from calendar import monthrange
from datetime import date
import json
from sqlalchemy import select,func,or_
from ..models import Session,Photo
from .library_service import query_photos
from .timeline_service import known_date
from .location_index import places

def summary(day,count_mode='capture'):
    try:
        today=date.fromisoformat(day)
        if today.isoformat()!=day:raise ValueError()
    except (ValueError,TypeError):raise ValueError('Invalid timeline date.') from None
    q=query_photos({},count_mode);source=q.where(known_date(Photo.date_taken),func.substr(Photo.date_taken,1,10)<=day).subquery()
    def card(row,kind):
        period,count,cover=row
        last=period if kind=='anniversary' else f'{period}-{monthrange(int(period[:4]),int(period[5:7]))[1]:02}'
        return dict(key=period,kind=kind,label=period,count=count,cover_id=cover,filters=dict(date_from=period if kind=='anniversary' else period+'-01',date_to=min(last,day)))
    with Session() as session:
        d=func.substr(source.c.date_taken,1,10)
        memories=[card(row,'anniversary') for row in session.execute(select(d,func.count(),func.min(source.c.id)).where(d<day,func.substr(d,6,5)==day[5:]).group_by(d).order_by(d.desc()).limit(6))]
        month=func.substr(source.c.date_taken,1,7);excluded={m['key'][:7] for m in memories}
        memories.extend(card(row,'month') for row in session.execute(select(month,func.count(),func.min(source.c.id)).where(month.not_in(excluded)).group_by(month).order_by(month.desc()).limit(6-len(memories))))
        scope=q.with_only_columns(Photo.id).order_by(None).correlate(None);p=places.c
        named=select(p.country,p.city,p.label,func.count(),func.min(p.photo_id)).where(p.photo_id.in_(scope),or_(p.country!='',p.city!='',p.label!='')).group_by(p.country,p.city,p.label).order_by(func.count().desc(),p.country,p.city,p.label).limit(6)
        cards=[]
        for country,city,label,count,cover in session.execute(named):
            key=json.dumps([country,city,label],ensure_ascii=False,separators=(',',':'))
            cards.append(dict(key=key,kind='place',label=' · '.join(v for v in (country,city,label) if v),count=count,cover_id=cover,filters=dict(location_exact=key)))
        located=session.scalar(select(func.count()).select_from(places).where(p.photo_id.in_(scope),p.latitude.is_not(None))) or 0
        unknown=session.scalar(select(func.count()).select_from(q.where(func.coalesce(known_date(Photo.date_taken),False)==False).subquery())) or 0
    return dict(memories=memories,places=cards,located=located,unknown_date=unknown,count_mode=count_mode)
