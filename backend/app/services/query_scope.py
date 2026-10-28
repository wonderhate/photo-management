"""Immutable local query base. Temporary filters always refine its result set."""
import json
import math
import re
from .photo_query import normalize as query_normalize
from .photo_facets import normalize as facets_normalize

NUMERIC=('focal_length','f_number','iso','exposure_seconds')
FILTER_KEYS={'album_id','person_id','camera','lens','camera_make','camera_model','lens_model','search','text','filename','semantic','semantic_threshold','favorite','rating','color_label','analyzed_color','geo_bounds','geo_presence','location_exact','location_country','location_city','flag','tag','date_from','date_to','orientation','file_type','query','facets'}|{f+s for f in NUMERIC for s in ('','_min','_max','_lt','_gt')}
ORIGINS=('library','collection','person','stats','reports','favorite','query')

def invalid():raise ValueError('Invalid photo scope.')
def compact(value):return json.dumps(value,ensure_ascii=False,separators=(',',':'),allow_nan=False)
def bounded(value):
    try:
        if len(compact(value).encode('utf-8'))>32768:invalid()
    except (ValueError,TypeError,RecursionError,UnicodeError):invalid()
def text(value):
    if not isinstance(value,str) or len(value)>256 or '\0' in value or any(0xd800<=ord(c)<=0xdfff for c in value):invalid()
    return value

def base(value):
    if not isinstance(value,dict):invalid()
    result={}
    for raw,v in value.items():
        if raw not in FILTER_KEYS or not isinstance(v,str):invalid()
        if not v:continue
        key={'camera':'camera_model','lens':'lens_model'}.get(raw,raw);nxt=v
        if key=='query':
            try:parsed=json.loads(v)
            except (ValueError,RecursionError):invalid()
            nxt=compact(query_normalize(parsed))
        elif key=='facets':nxt=compact(facets_normalize(v))
        elif key=='geo_bounds':
            from .location_index import bounds
            nxt=compact(bounds(v))
        elif key=='geo_presence':
            if v not in ('located','unlocated'):invalid()
        elif key=='location_exact':
            from .location_index import exact_place
            nxt=compact(exact_place(v))
        elif key in ('location_country','location_city'):
            nxt=text(v)
            if len(nxt)>120 or any(ord(c)<32 for c in nxt):invalid()
        elif key in ('album_id','person_id'):
            if not re.fullmatch(r'[a-zA-Z0-9-]{1,80}',v):invalid()
        elif key=='favorite':
            if v not in ('true','false','1','0'):invalid()
            nxt='true' if v in ('true','1') else 'false'
        elif key=='rating':
            if not re.fullmatch(r'[0-9]+',v) or int(v)>5:invalid()
            nxt=str(int(v))
        elif key=='analyzed_color':
            if not re.fullmatch(r'#[a-fA-F0-9]{6}',v):invalid()
            nxt=v.lower()
        elif any(key==f or key.startswith(f+'_') for f in NUMERIC) or key=='semantic_threshold':
            if not re.fullmatch(r'[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?',v.strip()):invalid()
            n=float(v)
            if not math.isfinite(n) or not 0<=n<=(1 if key=='semantic_threshold' else 1e12):invalid()
            nxt=v.strip()
        elif key in ('date_from','date_to'):query_normalize(dict(version=1,root=dict(op='gte',field='date_taken',value=v)))
        elif key=='orientation':
            if v not in ('landscape','portrait','square'):invalid()
        elif key=='flag':
            if v not in ('picked','rejected','unmarked'):invalid()
        elif key=='file_type':
            if v not in ('all','raw','jpeg','paired','raw_only','jpeg_only'):invalid()
            if v=='all':continue
        else:nxt=text(v)
        if key in result and result[key]!=nxt:invalid()
        result[key]=nxt
    return result

def normalize(value):
    if isinstance(value,str):
        if len(value.encode('utf-8'))>32768:invalid()
        try:value=json.loads(value)
        except (ValueError,RecursionError):invalid()
    bounded(value)
    if not isinstance(value,dict) or not set(value)<={'version','library_id','mode','base','origin'} or type(value.get('version')) is not int or value['version']!=1 or not isinstance(value.get('library_id'),str) or not re.fullmatch(r'[a-zA-Z0-9-]{1,80}',value['library_id']) or value.get('mode') not in ('capture','file') or ('origin' in value and value['origin'] not in ORIGINS):invalid()
    normalized=base(value.get('base'));origin=value.get('origin') or ('collection' if normalized.get('album_id') else 'person' if normalized.get('person_id') else 'favorite' if normalized.get('favorite')=='true' else 'query' if normalized else 'library')
    result=dict(version=1,library_id=value['library_id'],mode=value['mode'],base=normalized,origin=origin);bounded(result);return result

def assert_library(scope):
    from ..models import Session,LibraryProfile,Album,FacePerson
    with Session() as session:
        row=session.get(LibraryProfile,1)
        if row is None or row.library_id!=scope['library_id']:raise ValueError('Search scope belongs to another library.')
        if scope['base'].get('album_id') and session.get(Album,scope['base']['album_id']) is None:raise ValueError('The scoped collection no longer exists.')
        if scope['base'].get('person_id') and session.get(FacePerson,scope['base']['person_id']) is None:raise ValueError('The scoped person no longer exists.')
