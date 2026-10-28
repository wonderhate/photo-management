"""Bounded map responses: aggregate in SQL, never ship a 100,000 point array."""
from sqlalchemy import select,func,case,cast,Integer
from ..models import Session,Photo
from .location_index import places,viewport,bounds

WORLD=dict(west=-180,south=-90,east=180,north=90)

def summary(values,view=None):
    from .library_service import query_photos
    b=bounds(view or WORLD);p=places.c
    scope=query_photos(values).with_only_columns(Photo.id).order_by(None).correlate(None)
    scoped=p.photo_id.in_(scope)
    width=max(b['east']-b['west'] if b['east']>=b['west'] else 360-b['west']+b['east'],1e-9)
    height=max(b['north']-b['south'],1e-9)
    x=case((p.longitude<b['west'],p.longitude-b['west']+360),else_=p.longitude-b['west'])
    cell_x=func.min(63,cast(x/width*64,Integer));cell_y=func.min(31,cast((b['north']-p.latitude)/height*32,Integer))
    grouped=select(func.avg(p.latitude).label('latitude'),func.avg(x).label('x'),func.count().label('count'),func.min(p.photo_id).label('photo_id')).where(scoped,viewport(b)).group_by(cell_x,cell_y).subquery()
    with Session() as session:
        total=session.scalar(select(func.count()).select_from(scope.subquery())) or 0
        located=session.scalar(select(func.count()).select_from(places).where(scoped,p.latitude.is_not(None))) or 0
        cluster_count,in_view=session.execute(select(func.count(),func.coalesce(func.sum(grouped.c.count),0)).select_from(grouped)).one()
        clusters=[dict(latitude=r.latitude,longitude=(b['west']+r.x+180)%360-180,count=r.count,photo_id=r.photo_id) for r in session.execute(select(grouped).order_by(grouped.c.count.desc(),grouped.c.photo_id).limit(300))]
        def facet(field):
            col=getattr(p,field)
            return [dict(value=r[0],count=r[1]) for r in session.execute(select(col,func.count()).where(scoped,col!='').group_by(col).order_by(func.count().desc(),col).limit(101))]
        countries,cities=facet('country'),facet('city')
    return dict(total=total,located=located,unlocated=total-located,in_view=in_view,cluster_count=cluster_count,truncated=cluster_count>300,clusters=clusters,countries=countries[:100],cities=cities[:100],facets_truncated=len(countries)>100 or len(cities)>100)
