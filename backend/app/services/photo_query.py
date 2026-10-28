"""Validated metadata AST compiled to bound SQL expressions, never SQL text."""
import json
import math
from datetime import datetime
from sqlalchemy import and_, or_, not_, exists, select, func, case
from ..models import Photo, PhotoTag, Tag
from .text_search import ANNOTATION_QUERY_FIELDS,column as text_column

FIELDS={**dict.fromkeys(('file_name','camera_make','camera_model','lens_model','color_label','file_format'),'text'),
    **dict.fromkeys(ANNOTATION_QUERY_FIELDS,'text'),
    **dict.fromkeys(('width','height','focal_length','focal_length_35mm','f_number','iso','exposure_seconds'),'number'),
    'tag':'tag','orientation':'shape','rating':'rating','flag':'flag','favorite':'boolean','is_raw':'boolean','date_taken':'date','created_at':'date'}


def invalid():raise ValueError('Invalid photo query.')


def scalar(field,value):
    kind=FIELDS[field]
    if kind=='shape':return value if type(value) is str and value in ('landscape','portrait','square') else invalid()
    if kind=='flag':return value if type(value) is str and value in ('picked','rejected','unmarked') else invalid()
    if kind=='boolean':return value if type(value) is bool else invalid()
    if kind in ('number','rating'):
        if type(value) not in (int,float) or not math.isfinite(value) or not 0<=value<=1e12:invalid()
        if kind=='rating' and (value!=int(value) or value>5):invalid()
        return int(value) if value==int(value) else value
    if not isinstance(value,str) or len(value)>256 or '\x00' in value or any(0xd800<=ord(c)<=0xdfff for c in value):invalid()
    if kind=='date':
        import re
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2})?',value):invalid()
        try:datetime.fromisoformat(value)
        except ValueError:invalid()
    return value+'T00:00:00' if kind=='date' and len(value)==10 else value


def normalize(value):
    try:
        if len(json.dumps(value,ensure_ascii=False,allow_nan=False,separators=(',',':')).encode('utf-8'))>32768:invalid()
    except (TypeError,ValueError,RecursionError):invalid()
    if not isinstance(value,dict) or set(value)!={'version','root'} or type(value['version']) is not int or value['version']!=1:invalid()
    count=0
    def node(value,depth):
        nonlocal count
        count+=1
        if depth>8 or count>128 or not isinstance(value,dict):invalid()
        op=value.get('op')
        if op in ('and','or'):
            if set(value)!={'op','children'} or not isinstance(value['children'],list) or not 1<=len(value['children'])<=32:invalid()
            return dict(op=op,children=[node(child,depth+1) for child in value['children']])
        if op=='not':
            if set(value)!={'op','child'}:invalid()
            return dict(op=op,child=node(value['child'],depth+1))
        field=value.get('field')
        if not isinstance(field,str) or field not in FIELDS or op not in ('eq','ne','lt','lte','gt','gte','contains','icontains','in','is_null','not_null'):invalid()
        empty=op in ('is_null','not_null')
        if set(value)!=({'op','field'} if empty else {'op','field','value'}):invalid()
        result=dict(op=op,field=field)
        if empty:return result
        kind=FIELDS[field]
        if op in ('contains','icontains') and kind not in ('text','tag') or op in ('lt','lte','gt','gte') and kind not in ('number','rating','date'):invalid()
        if op=='in':
            if not isinstance(value['value'],list) or not 1<=len(value['value'])<=32:invalid()
            result['value']=list(dict.fromkeys(scalar(field,v) for v in value['value']))
        else:result['value']=scalar(field,value['value'])
        return result
    return dict(version=1,root=node(value['root'],0))


def expression(query):
    query=normalize(query)
    def compile(node):
        op=node['op']
        if op in ('and','or'):return (and_ if op=='and' else or_)(*[compile(child) for child in node['children']])
        if op=='not':return not_(compile(node['child']))
        field=node['field'];value=node.get('value')
        if field=='tag':
            def tagged(condition=True):
                return exists(select(PhotoTag.photo_id).join(Tag).where(PhotoTag.photo_id==Photo.id,condition))
            if op=='is_null':return not_(tagged())
            if op=='not_null':return tagged()
            if op=='in':return tagged(Tag.name.in_(value))
            if op=='contains':return tagged(func.instr(Tag.name,value)>0)
            if op=='icontains':return tagged(func.pc_text_contains(Tag.name,value)==1)
            found=tagged(Tag.name==value)
            return found if op=='eq' else not_(found)
        column=field_column(field)
        if op=='is_null':return column.is_(None)
        if op=='not_null':return column.is_not(None)
        if FIELDS[field]=='date':column=case((func.length(column)==10,column+'T00:00:00'),else_=func.substr(column,1,19))
        if op=='contains':condition=func.instr(column,value)>0
        elif op=='icontains':condition=func.pc_text_contains(column,value)==1
        elif op=='in':condition=column.in_(value)
        else:condition={'eq':column.__eq__,'ne':column.__ne__,'lt':column.__lt__,'lte':column.__le__,'gt':column.__gt__,'gte':column.__ge__}[op](value)
        # Every leaf is two-valued: NULL comparisons are false, NOT can then
        # include missing values intentionally rather than inheriting SQL UNKNOWN.
        if op in ('contains','icontains'):
            from .text_index import candidate
            candidates=candidate(field,op,value)
            if candidates is not None:condition=and_(candidates,condition)
        return and_(column.is_not(None),condition)
    return compile(query['root'])

def uses_text_index(query):
    from .text_search import INDEXED_FIELDS
    def visit(node):
        if node['op'] in ('and','or'):return any(visit(child) for child in node['children'])
        if node['op']=='not':return visit(node['child'])
        return node['op'] in ('contains','icontains') and node['field'] in INDEXED_FIELDS and len(node.get('value',''))>=3
    return visit(normalize(query)['root'])


def field_column(field):
    if field=='orientation':return case((and_(Photo.width>0,Photo.height>0),case((Photo.width>Photo.height,'landscape'),(Photo.width<Photo.height,'portrait'),else_='square')),else_=None)
    return text_column(field) if field in ANNOTATION_QUERY_FIELDS else getattr(Photo,field)
