"""Bounded, scoped tag search. Canonical PhotoTag remains the authority."""
from sqlalchemy import select,func,case,text
from ..models import Session,Photo,PhotoTag,Tag
from .library_service import query_photos

def options(filters,term='',page=1,size=60,order='name',origins=True):
    if not isinstance(term,str) or len(term)>256 or '\0' in term or not 1<=page<=1000000 or not 1<=size<=100 or order not in ('name','count','manual'):raise ValueError('Invalid photo tags query.')
    base=query_photos(filters).with_only_columns(Photo.id).order_by(None).correlate(None)
    eligible=PhotoTag.photo_id.in_(base)
    with Session() as s:
        s.execute(text('BEGIN'))
        total=s.scalar(select(func.count()).select_from(base.subquery()))
        present=s.scalar(select(func.count(func.distinct(PhotoTag.photo_id))).where(eligible))
        count=func.count(PhotoTag.photo_id);manual=func.sum(case((func.coalesce(PhotoTag.origin,'user')!='ai',1),else_=0))
        query=select(Tag.name,count,manual).join(PhotoTag).where(eligible)
        if term:query=query.where(func.pc_text_contains(Tag.name,term)==1)
        query=query.group_by(Tag.id)
        ordering=[count.desc(),Tag.name] if order=='count' else [(manual>0).desc(),Tag.name] if order=='manual' else [Tag.name]
        rows=s.execute(query.order_by(*ordering).offset((page-1)*size).limit(size+1)).all()
        return dict(field='tag',total=total,missing=total-present,page=page,has_more=len(rows)>size,values=[dict(value=v,count=n,**(dict(user_count=u) if origins else {})) for v,n,u in rows[:size]])
