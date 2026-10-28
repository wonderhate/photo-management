"""Versioned catalog-only places. GPS bytes and original files are read-only."""
import math,re
from datetime import datetime,timezone

def invalid():raise ValueError('Invalid photo location.')
def exact(value,keys):
    if not isinstance(value,dict) or set(value)-set(keys):invalid()
def number(value,low,high):
    if value is None:return None
    if type(value) not in (int,float) or not math.isfinite(value) or not low<=value<=high:invalid()
    return value
def text(value,maximum=120):
    if not isinstance(value,str) or len(value)>maximum or any(ord(c)<32 or ord(c)==127 or 0xd800<=ord(c)<=0xdfff for c in value):invalid()
    return value.strip()
def manual(value):
    exact(value,('latitude','longitude','country','city','label','accuracy_m'))
    if set(value)!=set(('latitude','longitude','country','city','label','accuracy_m')):invalid()
    lat=number(value['latitude'],-90,90);lon=number(value['longitude'],-180,180);accuracy=number(value['accuracy_m'],0,20040000)
    if (lat is None)!=(lon is None) or lat is None and accuracy is not None:invalid()
    result=dict(latitude=lat,longitude=lon,country=text(value['country']),city=text(value['city']),label=text(value['label'],240),accuracy_m=accuracy)
    if lat is None and not any(result[k] for k in ('country','city','label')):invalid()
    return result
def validate(record):
    exact(record,('version','photo_id','source_hash','revision','manual','history','updated_at'))
    if type(record.get('version')) is not int or record['version']!=1 or not isinstance(record.get('photo_id'),str) or not re.fullmatch(r'[a-zA-Z0-9_][a-zA-Z0-9_-]{0,79}',record['photo_id']):invalid()
    if not isinstance(record.get('source_hash'),str) or not re.fullmatch('[a-f0-9]{64}',record['source_hash']) or type(record.get('revision')) is not int or not 1<=record['revision']<=9007199254740991:invalid()
    stamp=record.get('updated_at')
    if not isinstance(stamp,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z',stamp):invalid()
    try:datetime.fromisoformat(stamp)
    except ValueError:invalid()
    if 'manual' not in record:invalid()
    if record['manual'] is not None:manual(record['manual'])
    if not isinstance(record.get('history'),list) or len(record['history'])>20:invalid()
    for item in record['history']:
        if item is not None:manual(item)
    return record
def change(photo,previous,value):
    exact(value,('source_hash','expected_revision','operation','value'))
    if type(value.get('expected_revision')) is not int or not 0<=value['expected_revision']<=9007199254740991:invalid()
    if not isinstance(value.get('source_hash'),str) or not re.fullmatch('[a-f0-9]{64}',value['source_hash']):invalid()
    operation=value.get('operation')
    if operation not in ('set','clear','undo') or operation!='set' and 'value' in value:invalid()
    if previous:validate(previous)
    if photo.file_hash!=value['source_hash'] or (previous['revision'] if previous else 0)!=value['expected_revision'] or previous and previous['source_hash']!=photo.file_hash:
        raise ValueError('Location source or revision changed. Reload the photo.')
    history=list(previous['history']) if previous else [];current=previous['manual'] if previous else None
    if operation=='undo':
        if not history:raise ValueError('No location change to undo.')
        result=history.pop()
    else:
        result=manual(value.get('value')) if operation=='set' else None;history.append(current)
    return validate(dict(version=1,photo_id=photo.id,source_hash=photo.file_hash,revision=value['expected_revision']+1,manual=result,history=history[-20:],updated_at=datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')))
def effective(photo,record=None):
    if record and record['source_hash']==photo.file_hash and record['manual'] is not None:return record['manual']|{'source':'manual'}
    lat,lon=photo.gps_latitude,photo.gps_longitude
    valid=type(lat) in (int,float) and math.isfinite(lat) and -90<=lat<=90 and type(lon) in (int,float) and math.isfinite(lon) and -180<=lon<=180
    return dict(source='exif' if valid else 'none',latitude=lat if valid else None,longitude=lon if valid else None,country='',city='',label='',accuracy_m=None)
