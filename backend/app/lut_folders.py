from .lut_context import input_comments
"""Pure versioned LUT directory records; never contains source file bytes."""
import re
from .cube_lut import validate_lut_asset
MAX_FOLDERS=20;MAX_ENTRIES=5000;MAX_DEPTH=8

def valid_path(path):
    return type(path) is str and len(path.encode('utf-16-le'))//2<=2048 and len(path.split('/'))<=MAX_DEPTH+1 and all(p and p not in ('.','..') and not re.search(r'[\\\x00-\x1f\x7f]',p) for p in path.split('/'))

def validate_folders(value):
    def fail():raise ValueError('Invalid LUT folder data.')
    if type(value) is not list or len(value)>MAX_FOLDERS:fail()
    ids=set()
    for f in value:
        if type(f) is not dict or set(f)!={'version','id','binding','name','revision','state','entries','truncated'}:fail()
        if type(f['version']) is not int or f['version']!=1 or type(f['id']) is not str or not re.fullmatch(r'[a-f0-9-]{36}',f['id']) or f['id'] in ids or type(f['binding']) is not str or not re.fullmatch(r'[a-f0-9-]{36}',f['binding']) or type(f['name']) is not str or not f['name'].strip() or len(f['name'].encode('utf-16-le'))//2>255 or re.search(r'[\x00-\x1f\x7f]',f['name']) or type(f['revision']) is not int or not 0<=f['revision']<=2**53-1 or f['state'] not in ('ready','missing','permission','error') or type(f['truncated']) is not bool or type(f['entries']) is not list or len(f['entries'])>MAX_ENTRIES:fail()
        ids.add(f['id']);paths=set()
        for e in f['entries']:
            if type(e) is not dict or set(e)!={'path','stamp','asset','comments','error'}:fail()
            path=e['path']
            if type(path) is not str or len(path.encode('utf-16-le'))//2>2048 or len(path.split('/'))>MAX_DEPTH+1 or any(not p or p in ('.','..') or re.search(r'[\\\x00-\x1f\x7f]',p) for p in path.split('/')) or path in paths or type(e['stamp']) is not str or len(e['stamp'])>160 or type(e['comments']) is not list or len(e['comments'])>32 or any(type(c) is not str or len(c.encode('utf-16-le'))//2>512 or re.search(r'[\x00-\x1f\x7f]',c) for c in e['comments']) or e['error'] not in (None,'header','size','unreadable','changed'):fail()
            paths.add(path)
            if e['asset'] is not None:
                validate_lut_asset(e['asset'])
                if e['error'] is not None or e['asset']['name']!=path.split('/')[-1]:fail()
            elif e['error'] is None:fail()

def header(text):
    comments=input_comments(text)
    sizes=re.findall(r'^\s*LUT_3D_SIZE\s+(\d+)\s*(?:#.*)?$',text,re.M|re.I);titles=re.findall(r'^\s*TITLE\s+([^\r\n]*)',text,re.M|re.I)
    if re.search(r'^\s*LUT_[12]D_',text,re.M|re.I) or len(sizes)!=1 or not 2<=int(sizes[0])<=65 or len(titles)>1:raise ValueError('header')
    raw=titles[0].strip() if titles else '';quoted=re.fullmatch(r'"([^"\r\n]*)"\s*(?:#.*)?',raw)
    if raw.startswith('"') and not quoted:raise ValueError('header')
    title=quoted[1] if quoted else raw.split('#',1)[0].strip()
    if len(title.encode('utf-16-le'))//2>255 or re.search(r'[\x00-\x1f\x7f]',title):raise ValueError('header')
    return dict(size=int(sizes[0]),title=title,comments=comments)
