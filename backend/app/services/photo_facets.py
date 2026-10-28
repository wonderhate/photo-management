"""Bounded facet state compiled into the same metadata AST as rule collections."""
import json
from .photo_query import normalize as query_normalize

FACETS=dict(camera_make='values',camera_model='values',lens_model='values',tag='values',file_format='values',orientation='values',color_label='values',flag='values',rating='number',favorite='boolean',is_raw='boolean',focal_length='number',f_number='number',iso='number',exposure_seconds='number',date_taken='date',created_at='date',description='text',user_description='text',ai_caption='text',detected_text='text')

def invalid():raise ValueError('Invalid photo facets.')
def single(field,op,value=None):return query_normalize(dict(version=1,root=dict(field=field,op=op,**({} if op=='is_null' else {'value':value}))))['root']

def node(item):
    field=item['field'];parts=[];op=item['op']
    if op=='in' and item.get('values'):
        parts.append(dict(op='and',children=[single(field,'eq',v) for v in item['values']]) if field=='tag' and item.get('match')=='all' else single(field,'in',item['values']))
    if op=='contains' and item.get('text'):parts.append(single(field,'icontains',item['text']))
    if op=='range':
        ranges=[]
        if 'min' in item:ranges.append(single(field,'gt' if item.get('min_exclusive') else 'gte',item['min']))
        if 'max' in item:
            upper=item['max'];upper=upper+'T23:59:59' if FACETS[field]=='date' and isinstance(upper,str) and len(upper)==10 and not item.get('max_exclusive') else upper
            ranges.append(single(field,'lt' if item.get('max_exclusive') else 'lte',upper))
        if ranges:parts.append(ranges[0] if len(ranges)==1 else dict(op='and',children=ranges))
    if item.get('missing'):parts.append(single(field,'is_null'))
    if not parts:return None
    result=parts[0] if len(parts)==1 else dict(op='or',children=parts)
    return dict(op='not',child=result) if item.get('exclude') else result

def normalize(value):
    if isinstance(value,str):
        if len(value.encode('utf-8'))>32768:invalid()
        try:value=json.loads(value)
        except (ValueError,RecursionError):invalid()
    try:
        if len(json.dumps(value,ensure_ascii=False,allow_nan=False,separators=(',',':')).encode('utf-8'))>32768:invalid()
    except (ValueError,TypeError,RecursionError,UnicodeError):invalid()
    if not isinstance(value,dict) or set(value)!={'version','items'} or type(value['version']) is not int or value['version']!=1 or not isinstance(value['items'],list) or len(value['items'])>len(FACETS):invalid()
    used=set();items=[]
    for raw in value['items']:
        if not isinstance(raw,dict) or not isinstance(raw.get('field'),str) or raw['field'] not in FACETS or raw['field'] in used:invalid()
        field=raw['field'];used.add(field);kind=FACETS[field];op=raw.get('op')
        if op not in ('in','range','contains'):invalid()
        allowed={'field','op','missing','exclude'}|({'values','match'} if op=='in' else {'min','max','min_exclusive','max_exclusive'} if op=='range' else {'text'})
        if not set(raw)<=allowed or any(k in raw and type(raw[k]) is not bool for k in ('missing','exclude','min_exclusive','max_exclusive')):invalid()
        item=dict(field=field,op=op,**{k:True for k in ('missing','exclude') if raw.get(k)})
        if op=='in':
            if kind=='text' or not isinstance(raw.get('values'),list) or len(raw['values'])>32 or ('match' in raw and (field!='tag' or raw['match'] not in ('any','all'))):invalid()
            item['values']=single(field,'in',raw['values'])['value'] if raw['values'] else []
            if raw.get('match')=='all':item['match']='all'
        elif op=='range':
            if kind not in ('number','date'):invalid()
            for k in ('min_exclusive','max_exclusive'):
                if raw.get(k):item[k]=True
            for key,comparison in [('min','gte'),('max','lte')]:
                if key in raw:single(field,comparison,raw[key]);item[key]=raw[key]
            if 'min' in item and 'max' in item and item['min']>item['max']:invalid()
        else:
            if kind!='text' or not isinstance(raw.get('text'),str):invalid()
            single(field,'icontains',raw['text']);item['text']=raw['text']
        if node(item):items.append(item)
    items.sort(key=lambda item:list(FACETS).index(item['field']))
    result=dict(version=1,items=items);query(result);return result

def query(state,omit=None):
    children=[node(item) for item in state['items'] if item['field']!=omit]
    return query_normalize(dict(version=1,root=children[0] if len(children)==1 else dict(op='and',children=children))) if children else None

def keys(field):
    if field=='camera_model':return ['camera_model','camera']
    if field=='lens_model':return ['lens_model','lens']
    if field=='date_taken':return ['date_from','date_to']
    if field in ('focal_length','f_number','iso','exposure_seconds'):return [field]+[field+s for s in ('_min','_max','_lt','_gt')]
    return [field] if field in ('camera_make','tag','orientation','color_label','flag','rating','favorite','is_raw') else []

def without(filters,field):
    result={k:v for k,v in filters.items() if k not in keys(field)}
    if result.get('facets'):
        state=normalize(result['facets']);state['items']=[item for item in state['items'] if item['field']!=field];result['facets']=state
    return result
