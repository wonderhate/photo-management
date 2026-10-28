"""Rebuildable, transactionally updated local place cache and SQLite R*Tree.

Source coordinates stay in photos/photo_locations; no network/geocoder is used.
The R*Tree uses outward-rounded floats, so exact bounds are checked afterwards.
"""
import json
import math
from sqlalchemy import table,column,select,and_,or_

VERSION=2
places=table('pc_places',*[column(k) for k in ('key','photo_id','latitude','longitude','country','city','label','source','accuracy_m')])
spatial=table('pc_place_rtree',*[column(k) for k in ('key','min_lat','max_lat','min_lon','max_lon')])
SOURCE="""
 SELECT p.rowid AS key,p.id AS photo_id,
 CASE WHEN json_type(l.record,'$.manual')='object' THEN json_extract(l.record,'$.manual.latitude') ELSE p.gps_latitude END AS lat,
 CASE WHEN json_type(l.record,'$.manual')='object' THEN json_extract(l.record,'$.manual.longitude') ELSE p.gps_longitude END AS lon,
 COALESCE(json_extract(l.record,'$.manual.country'),'') AS country,
 COALESCE(json_extract(l.record,'$.manual.city'),'') AS city,
 COALESCE(json_extract(l.record,'$.manual.label'),'') AS label,
 CASE WHEN json_type(l.record,'$.manual')='object' THEN 'manual' ELSE 'exif' END AS source,
 json_extract(l.record,'$.manual.accuracy_m') AS accuracy_m
 FROM photos p LEFT JOIN photo_locations l ON l.photo_id=p.id AND json_extract(l.record,'$.source_hash')=p.file_hash
 WHERE p.removed_at IS NULL
"""
VALID="typeof(lat) IN ('integer','real') AND typeof(lon) IN ('integer','real') AND lat BETWEEN -90 AND 90 AND lon BETWEEN -180 AND 180"
SELECT=f"SELECT key,photo_id,CASE WHEN {VALID} THEN lat END,CASE WHEN {VALID} THEN lon END,country,city,label,CASE WHEN source='manual' THEN source WHEN {VALID} THEN 'exif' ELSE 'none' END,accuracy_m FROM ({SOURCE})"

def initialize(engine,force=False):
    with engine.begin() as c:
        c.exec_driver_sql('BEGIN IMMEDIATE')
        tables={r[0] for r in c.exec_driver_sql("SELECT name FROM sqlite_master WHERE type='table'")}
        installed={r[0] for r in c.exec_driver_sql("SELECT name FROM sqlite_master WHERE type='trigger'")}
        c.exec_driver_sql('CREATE TABLE IF NOT EXISTS pc_place_meta(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL)')
        old=c.exec_driver_sql('SELECT version FROM pc_place_meta WHERE id=1').scalar()
        c.exec_driver_sql('CREATE TABLE IF NOT EXISTS pc_places(key INTEGER PRIMARY KEY,photo_id TEXT UNIQUE NOT NULL,latitude REAL,longitude REAL,country TEXT NOT NULL,city TEXT NOT NULL,label TEXT NOT NULL,source TEXT NOT NULL,accuracy_m REAL)')
        c.exec_driver_sql('CREATE INDEX IF NOT EXISTS pc_place_country_city ON pc_places(country,city)')
        c.exec_driver_sql('CREATE INDEX IF NOT EXISTS pc_place_city ON pc_places(city)')
        c.exec_driver_sql('CREATE VIRTUAL TABLE IF NOT EXISTS pc_place_rtree USING rtree(key,min_lat,max_lat,min_lon,max_lon)')
        refresh=lambda key:f'DELETE FROM pc_place_rtree WHERE key IN (SELECT key FROM pc_places WHERE photo_id={key}); DELETE FROM pc_places WHERE photo_id={key}; INSERT INTO pc_places {SELECT} WHERE photo_id={key}; INSERT INTO pc_place_rtree SELECT key,latitude,latitude,longitude,longitude FROM pc_places WHERE photo_id={key} AND latitude IS NOT NULL;'
        triggers={
            'pc_place_photo_insert':'AFTER INSERT ON photos BEGIN '+refresh('new.id')+' END',
            'pc_place_photo_update':'AFTER UPDATE OF id,file_hash,gps_latitude,gps_longitude,removed_at ON photos BEGIN DELETE FROM pc_place_rtree WHERE key=old.rowid; DELETE FROM pc_places WHERE key=old.rowid; '+refresh('new.id')+' END',
            'pc_place_photo_delete':'AFTER DELETE ON photos BEGIN DELETE FROM pc_place_rtree WHERE key=old.rowid; DELETE FROM pc_places WHERE key=old.rowid; END',
            'pc_place_location_insert':'AFTER INSERT ON photo_locations BEGIN '+refresh('new.photo_id')+' END',
            'pc_place_location_update':'AFTER UPDATE ON photo_locations BEGIN '+refresh('old.photo_id')+refresh('new.photo_id')+' END',
            'pc_place_location_delete':'AFTER DELETE ON photo_locations BEGIN '+refresh('old.photo_id')+' END',
        }
        reset=force or old!=VERSION or not {'pc_places','pc_place_rtree'}<=tables or not set(triggers)<=installed
        if reset:
            for name in triggers:c.exec_driver_sql('DROP TRIGGER IF EXISTS '+name)
            c.exec_driver_sql('DELETE FROM pc_place_rtree');c.exec_driver_sql('DELETE FROM pc_places')
            c.exec_driver_sql('INSERT INTO pc_places '+SELECT)
            c.exec_driver_sql('INSERT INTO pc_place_rtree SELECT key,latitude,latitude,longitude,longitude FROM pc_places WHERE latitude IS NOT NULL')
        for name,sql in triggers.items():c.exec_driver_sql('CREATE TRIGGER IF NOT EXISTS '+name+' '+sql)
        c.exec_driver_sql('INSERT OR REPLACE INTO pc_place_meta VALUES(1,?)',(VERSION,))

def bounds(value):
    if isinstance(value,str):
        if len(value)>512:raise ValueError('Invalid map bounds.')
        try:value=json.loads(value)
        except (ValueError,RecursionError):raise ValueError('Invalid map bounds.') from None
    if not isinstance(value,dict) or set(value)!={'west','south','east','north'}:raise ValueError('Invalid map bounds.')
    if any(type(v) not in (int,float) or not math.isfinite(v) or abs(v)>(180 if k in ('west','east') else 90) for k,v in value.items()) or value['south']>value['north']:raise ValueError('Invalid map bounds.')
    return value

def viewport(value):
    b=bounds(value);p=places.c;r=spatial.c
    ranges=[(b['west'],b['east'])] if b['west']<=b['east'] else [(b['west'],180),(-180,b['east'])]
    candidate=select(r.key).where(r.min_lat<=b['north'],r.max_lat>=b['south'],or_(*(and_(r.min_lon<=east,r.max_lon>=west) for west,east in ranges)))
    return and_(p.key.in_(candidate),p.latitude>=b['south'],p.latitude<=b['north'],or_(*(and_(p.longitude>=west,p.longitude<=east) for west,east in ranges)))

def filters(values):
    criteria=[]
    if values.get('location_exact'):
        value=exact_place(values['location_exact'])
        criteria.extend(getattr(places.c,key)==value[i] for i,key in enumerate(('country','city','label')))
    for key in ('country','city'):
        value=values.get('location_'+key)
        if value:
            if not isinstance(value,str) or len(value)>120 or any(ord(c)<32 for c in value):raise ValueError('Invalid photo location.')
            criteria.append(getattr(places.c,key)==value)
    if values.get('geo_bounds'):criteria.append(viewport(values['geo_bounds']))
    presence=values.get('geo_presence')
    if presence:
        if presence not in ('located','unlocated'):raise ValueError('Invalid photo location.')
        criteria.append(places.c.latitude.is_(None) if presence=='unlocated' else places.c.latitude.is_not(None))
    return select(places.c.photo_id).where(*criteria) if criteria else None

def exact_place(value):
    if isinstance(value,str):
        if len(value)>4096:raise ValueError('Invalid photo location.')
        try:value=json.loads(value)
        except (ValueError,RecursionError):raise ValueError('Invalid photo location.') from None
    if not isinstance(value,list) or len(value)!=3 or any(not isinstance(v,str) or len(v)>(240 if i==2 else 120) or any(ord(c)<32 or ord(c)==127 or 0xd800<=ord(c)<=0xdfff for c in v) for i,v in enumerate(value)):raise ValueError('Invalid photo location.')
    return [v.strip() for v in value]
