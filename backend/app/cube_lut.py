from .lut_context import validate_context
"""Pure CUBE validation shared by import and offline library maintenance.

Conventions checked against AfterFrame (MIT, bundled attribution). Original
UTF-8 bytes, rather than a reserialized table, define the asset identity.
"""
import math
import re
import struct
from datetime import datetime

MAX_CUBE_BYTES=32*1024*1024
DECIMAL=re.compile(r'^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$',re.I)
HASH=re.compile(r'^[a-f0-9]{64}$')

def fail(code):raise ValueError('Invalid CUBE LUT: '+code)

def parse_cube(source:bytes):
    if type(source) is not bytes or not 0<len(source)<=MAX_CUBE_BYTES:fail('file_size')
    try:text=source.decode('utf-8-sig')
    except UnicodeDecodeError:fail('encoding')
    if '\0' in text:fail('encoding')
    title='';size=0;minimum=[0.,0.,0.];maximum=[1.,1.,1.];rows=0;seen=set()
    def numbers(tokens,n):
        if len(tokens)!=n or any(not DECIMAL.fullmatch(t) for t in tokens):fail('number')
        values=[float(t) for t in tokens]
        if any(not math.isfinite(v) for v in values):fail('number')
        return values
    for raw in re.split(r'\r\n|\r|\n',text):
        raw=raw.strip()
        if re.match(r'^TITLE\b',raw,re.I):
            if 'TITLE' in seen:fail('duplicate_header')
            seen.add('TITLE');value=raw[5:].strip()
            if value.startswith('"'):
                match=re.fullmatch(r'"([^"\r\n]*)"\s*(?:#.*)?',value)
                if not match:fail('title')
                title=match[1]
            else:title=value.split('#',1)[0].strip()
            if len(title.encode('utf-16-le'))//2>255 or re.search(r'[\x00-\x1f\x7f]',title):fail('title')
            continue
        clean=raw.split('#',1)[0].strip()
        if not clean:continue
        parts=clean.split();key=parts[0].upper()
        if re.match(r'^(?:LUT_[12]D_|LUT_1D$)',key):fail('shaper_unsupported')
        if key in ('LUT_3D_SIZE','DOMAIN_MIN','DOMAIN_MAX','LUT_3D_INPUT_RANGE'):
            if key in seen:fail('duplicate_header')
            seen.add(key)
            if key=='LUT_3D_SIZE':
                if rows:fail('late_size')
                value=numbers(parts[1:],1)[0]
                if not value.is_integer() or not 2<=value<=65:fail('size')
                size=int(value)
            elif key=='LUT_3D_INPUT_RANGE':
                if 'DOMAIN_MIN' in seen or 'DOMAIN_MAX' in seen:fail('ambiguous_domain')
                lo,hi=numbers(parts[1:],2);minimum=[lo]*3;maximum=[hi]*3
            else:
                if 'LUT_3D_INPUT_RANGE' in seen:fail('ambiguous_domain')
                if key=='DOMAIN_MIN':minimum=numbers(parts[1:],3)
                else:maximum=numbers(parts[1:],3)
            continue
        if re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*',parts[0]) and not re.fullmatch(r'[+-]?(nan|inf(?:inity)?)',parts[0],re.I):continue
        if not size:fail('missing_size')
        values=numbers(parts,3)
        if rows>=size**3:fail('row_count')
        for v in values:
            try:rounded=struct.unpack('<f',struct.pack('<f',v))[0]
            except OverflowError:fail('number')
            if not math.isfinite(rounded):fail('number')
        rows+=1
    if not size:fail('missing_size')
    if any(not lo<hi or not math.isfinite(hi-lo) for lo,hi in zip(minimum,maximum)):fail('domain')
    if rows!=size**3:fail('row_count')
    return {'title':title,'size':size,'domainMin':minimum,'domainMax':maximum}

def validate_lut_selection(value):
    if type(value) is not dict or set(value)!= {'version','asset_hash','strength','input'}:fail('selection')
    if type(value['version']) is not int or value['version']!=1 or type(value['asset_hash']) is not str or not HASH.fullmatch(value['asset_hash']) or type(value['strength']) not in (int,float) or not math.isfinite(value['strength']) or not 0<=value['strength']<=1 or value['input']!='srgb':fail('selection')

def validate_lut_asset(value):
    if type(value) is not dict or set(value)!= {'version','id','name','title','size','bytes','favorite','hidden','used_at'}|({'context'} if value.get('version')==2 else set()):fail('asset')
    if value.get('version')==2:validate_context(value['context'])
    if type(value['version']) is not int or value['version'] not in (1,2) or type(value['id']) is not str or not HASH.fullmatch(value['id']):fail('asset')
    for key in ('name','title'):
        s=value[key]
        if type(s) is not str or len(s.encode('utf-16-le'))//2>255 or re.search(r'[\x00-\x1f\x7f]',s) or key=='name' and not s.strip():fail('asset')
    if type(value['size']) is not int or not 2<=value['size']<=65 or type(value['bytes']) is not int or not 1<=value['bytes']<=MAX_CUBE_BYTES or type(value['favorite']) is not bool or type(value['hidden']) is not bool:fail('asset')
    if value['used_at'] is not None:
        stamp=value['used_at']
        if type(stamp) is not str or not re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z',stamp):fail('asset')
        try:datetime.strptime(stamp,'%Y-%m-%dT%H:%M:%S.%fZ')
        except ValueError:fail('asset')
