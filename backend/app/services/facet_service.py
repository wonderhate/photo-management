"""Scoped, disjunctive option counts. Only bounded metadata leaves the service."""
from sqlalchemy import select,func,exists,text,String
from ..models import Session,Photo,PhotoTag,Tag
from . import library_service,photo_facets,photo_query

def options(filters,field,term='',page=1,size=60,count_mode='capture'):
    if field not in photo_facets.FACETS or len(term)>256 or '\0' in term or not 1<=page<=1000000 or not 1<=size<=100 or count_mode not in ('capture','file'):raise ValueError('Invalid photo facets.')
    base=library_service.query_photos(photo_facets.without(filters,field),count_mode).with_only_columns(Photo.id).order_by(None)
    eligible=Photo.id.in_(base);kind=photo_facets.FACETS[field]
    with Session() as s:
        s.execute(text('BEGIN'))
        total=s.scalar(select(func.count()).select_from(Photo).where(eligible))
        if field=='tag':
            present=exists(select(PhotoTag.photo_id).where(PhotoTag.photo_id==Photo.id));column=Tag.name
            missing=s.scalar(select(func.count()).select_from(Photo).where(eligible,~present))
            q=select(column.label('value'),func.count(func.distinct(Photo.id)).label('count')).select_from(Photo).join(PhotoTag).join(Tag).where(eligible).group_by(column)
        else:
            column=photo_query.field_column(field)
            missing=s.scalar(select(func.count()).select_from(Photo).where(eligible,column.is_(None)))
            q=select(column.label('value'),func.count().label('count')).select_from(Photo).where(eligible,column.is_not(None)).group_by(column)
        bounds={}
        if kind in ('number','date'):
            low,high=s.execute(select(func.min(column),func.max(column)).select_from(Photo).where(eligible)).one();bounds=dict(min=low,max=high)
        if kind=='text':values=[];more=False
        else:
            if term:q=q.where(func.pc_text_contains(func.cast(column,String),term)==1)
            rows=s.execute(q.order_by(column).offset((page-1)*size).limit(size+1)).all();more=len(rows)>size
            values=[dict(value=bool(v) if kind=='boolean' else v,count=n) for v,n in rows[:size]]
        return dict(field=field,total=total,missing=missing,values=values,page=page,has_more=more,**bounds)
