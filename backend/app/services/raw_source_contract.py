import re
import unicodedata
from datetime import datetime

FIELDS={'version','id','file_hash','file_name','file_size','path','source_id','date_taken','camera_make','camera_model','lens_model','registered_at'}
RELATION={'version','photo_id','photo_hash','revision','raw_id','confirmed_at'}
HASH=re.compile(r'^[a-f0-9]{64}$');ID=re.compile(r'^[a-zA-Z0-9-]{1,80}$')
def fail():raise ValueError('Invalid RAW source record.')
def string(value,limit):return isinstance(value,str) and len(value)<=limit and not any(ord(c)<32 or ord(c)==127 or 0xd800<=ord(c)<=0xdfff for c in value)
def matches(pattern,value):return isinstance(value,str) and pattern.fullmatch(value)
def timestamp(value):
    if not isinstance(value,str) or not re.match(r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d',value):return False
    try:datetime.fromisoformat(value.replace('Z','+00:00'));return True
    except ValueError:return False
def validate(value):
    if not isinstance(value,dict) or set(value)!=FIELDS or type(value['version']) is not int or value['version']!=1 or not matches(HASH,value['id']) or value['file_hash']!=value['id'] or not string(value['file_name'],512) or not value['file_name'] or type(value['file_size']) is not int or not 1<=value['file_size']<=9_007_199_254_740_991 or not string(value['path'],32768) or not value['path'] or value['source_id'] is not None and not matches(ID,value['source_id']) or not timestamp(value['registered_at']):fail()
    if any(value[k] is not None and not string(value[k],512) for k in ('date_taken','camera_make','camera_model','lens_model')):fail()
    if value['source_id'] is not None and ('\\' in value['path'] or ':' in value['path'] or any(v in ('','.','..') for v in value['path'].split('/'))):fail()
    return value
def relation(value):
    if not isinstance(value,dict) or set(value)!=RELATION or type(value['version']) is not int or value['version']!=1 or not matches(ID,value['photo_id']) or not matches(HASH,value['photo_hash']) or type(value['revision']) is not int or not 1<=value['revision']<=9_007_199_254_740_991 or value['raw_id'] is not None and not matches(HASH,value['raw_id']) or not timestamp(value['confirmed_at']):fail()
    return value
def confirmation(value):
    if not isinstance(value,dict) or set(value)!={'photo_hash','expected_revision','raw_id','confirmed'} or not matches(HASH,value['photo_hash']) or type(value['expected_revision']) is not int or not 0<=value['expected_revision']<9_007_199_254_740_991 or value['raw_id'] is not None and not matches(HASH,value['raw_id']) or value['confirmed'] is not True:fail()
    return value
def candidate(photo,source):
    clean=lambda v:unicodedata.normalize('NFKC',v or '').strip().lower()
    stem=lambda v:clean(v.rsplit('.',1)[0])
    evidence=[];conflicts=[]
    if stem(photo.file_name)==stem(source['file_name']):evidence.append('name')
    try:
        if len(photo.date_taken or '')>=19 and len(source['date_taken'] or '')>=19:
            delta=abs((datetime.fromisoformat(photo.date_taken[:19])-datetime.fromisoformat(source['date_taken'][:19])).total_seconds())
            (evidence if delta<=2 else conflicts).append('time')
    except ValueError:pass
    a,b=clean(photo.camera_model),clean(source['camera_model'])
    if a and b:(evidence if a==b else conflicts).append('camera')
    score=(4 if 'name' in evidence else 0)+(6 if 'time' in evidence else 0)+(1 if 'camera' in evidence else 0)-len(conflicts)*8
    return dict(source=source,evidence=evidence,conflicts=conflicts,score=score)
