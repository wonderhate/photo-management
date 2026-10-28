"""Normalize optional supplements without replacing original EXIF or manual tags."""
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET
from . import exif_service

MAX_XMP=1024*1024
XMP_NS={
    'http://ns.adobe.com/exif/1.0/':'XMP-exif',
    'http://ns.adobe.com/tiff/1.0/':'XMP-tiff',
    'http://ns.adobe.com/xap/1.0/':'XMP-xmp',
    'http://ns.adobe.com/photoshop/1.0/':'XMP-photoshop',
    'http://ns.adobe.com/exif/1.0/aux/':'XMP-aux',
    'http://cipa.jp/exif/1.0/':'XMP-exifEX',
    'http://purl.org/dc/elements/1.1/':'XMP-dc',
    'http://ns.adobe.com/lightroom/1.0/':'XMP-lr',
}


def sidecars(path):
    """A file-specific sidecar precedes the shared basename; ambiguity is ignored."""
    selected=[]
    # Constant-count lookups, not a directory walk for every imported photograph.
    # Windows resolves mixed case; on case-sensitive hosts ambiguous variants are ignored.
    for base in (path.stem,path.name):
        candidates=[path.with_name(base+suffix) for suffix in ('.xmp','.XMP')]
        try:candidates=[p for p in candidates if p.is_file()]
        except OSError:continue
        if len(candidates)==2:
            try:
                if candidates[0].samefile(candidates[1]):candidates=candidates[:1]
            except OSError:continue
        if len(candidates)==1:selected.append(candidates[0])
    return selected


def parse_xmp(data):
    try:
        if isinstance(data,str):data=data.encode('utf-8')
        if not isinstance(data,bytes) or len(data)>MAX_XMP:return None
        encoding='utf-16' if data.startswith((b'\xff\xfe',b'\xfe\xff')) else 'utf-8-sig'
        document=data.decode(encoding)
        if '<!DOCTYPE' in document.upper() or '<!ENTITY' in document.upper():return None
        root=ET.fromstring(document);tags={};nodes=[];waiting=[(root,0)]
        while waiting:
            item,depth=waiting.pop();nodes.append(item)
            if depth>32 or len(nodes)>4096:return None
            waiting.extend((child,depth+1) for child in reversed(item))
        def key(name):
            if not name.startswith('{'):return None
            namespace,local=name[1:].split('}',1)
            return XMP_NS[namespace]+':'+local if namespace in XMP_NS else None
        for item in nodes:
            for name,value in item.attrib.items():
                label=key(name)
                if label:tags[label]=value[:4096]
            label=key(item.tag)
            if not label:continue
            values=[(child.text or '').strip() for child in item.iter() if child.tag=='{http://www.w3.org/1999/02/22-rdf-syntax-ns#}li']
            value=values if len(values)>1 else values[0] if values else (item.text or '').strip()
            if value:tags[label]=value[:64] if isinstance(value,list) else value[:4096]
        return tags
    except (ET.ParseError,ValueError,UnicodeError):return None


def read_xmp(path):
    try:
        if path.stat().st_size>MAX_XMP:return {}
        with path.open('rb') as stream:data=stream.read(MAX_XMP+1)
        tags=parse_xmp(data)
        if tags is not None:
            with path.open('rb') as stream:again=stream.read(MAX_XMP+1)
            if again!=data:return {}
        return {'tags':tags,'sha256':hashlib.sha256(data).hexdigest(),'name':path.name} if tags is not None else {}
    except OSError:return {}


def text(value):
    return str(value).replace('\x00','').strip()[:4096] if isinstance(value,(str,int,float)) and not isinstance(value,bool) else None


def from_tags(tags):
    def rank(key):
        return 20 if key.startswith('XMP-') else 0 if ':' not in key or key.split(':')[0] in ('original','ExifIFD','IFD0','GPS','File','Composite') else 10
    def first(names,convert=text,allow_xmp=True):
        # EXIF/MakerNote values precede XMP values; missing values stay missing.
        for name in names:
            entries=[(k,v) for k,v in tags.items() if k.split(':')[-1]==name and (allow_xmp or not k.startswith('XMP-'))]
            entries.sort(key=lambda pair:rank(pair[0]))
            for _,value in entries:
                result=convert(value)
                if result is not None and result!='':return result
        return None
    def numeric(value):
        return None if isinstance(value,bool) or value in (None,'') else exif_service.number(value)
    def positive(value):
        result=numeric(value);return result if result is not None and result>0 else None
    seconds=first(('ExposureTime',),positive)
    iso=first(('ISO','ISOSpeedRatings'),positive)
    orientation=first(('Orientation',),numeric,False)
    result=dict(camera_make=first(('Make',)),camera_model=first(('Model',)),lens_model=first(('LensModel','Lens','LensID')),
        width=first(('ExifImageWidth','ImageWidth'),positive,False),height=first(('ExifImageHeight','ImageHeight'),positive,False),
        f_number=first(('FNumber',),positive),exposure_seconds=seconds,exposure_time=exif_service.shutter(seconds),
        iso=int(iso) if iso and iso.is_integer() and iso<=2_147_483_647 else None,focal_length=first(('FocalLength',),positive),
        focal_length_35mm=first(('FocalLengthIn35mmFormat','FocalLengthIn35mmFilm'),positive),
        orientation=int(orientation) if orientation and orientation.is_integer() and 1<=orientation<=8 else None,
        date_taken=first(('DateTimeOriginal','DateCreated','CreateDate'),exif_service.date_string))
    for field,names,ref,limit in [('gps_latitude',('latitude','GPSLatitude'),'GPSLatitudeRef',90),('gps_longitude',('longitude','GPSLongitude'),'GPSLongitudeRef',180),('gps_altitude',('GPSAltitude',),'GPSAltitudeRef',None)]:
        reference=first((ref,))
        if limit is not None:result[field]=exif_service.gps(first(names,lambda v:v),reference,limit)
        else:
            reference=first((ref,),numeric)
            value=first(names,numeric)
            result[field]=-abs(value) if value is not None and reference==1 else value
    for key in ('width','height'):
        if result[key] is not None:result[key]=int(result[key]) if result[key].is_integer() and result[key]<=100_000_000 else None
    if result['width'] and result['height'] and result['width']*result['height']>100_000_000:
        result['width']=result['height']=None
    return result


def extract(path,supplement=None,source_hash=None):
    result=exif_service.extract(path,include_xmp=True);embedded=result.pop('_embedded_xmp',None)
    names={'camera_make':'Make','camera_model':'Model','lens_model':'LensModel','width':'ImageWidth','height':'ImageHeight',
        'f_number':'FNumber','exposure_seconds':'ExposureTime','iso':'ISO','focal_length':'FocalLength',
        'focal_length_35mm':'FocalLengthIn35mmFormat','orientation':'Orientation','date_taken':'DateTimeOriginal',
        'gps_latitude':'latitude','gps_longitude':'longitude','gps_altitude':'GPSAltitude'}
    result.update(from_tags({'original:'+name:result.get(field) for field,name in names.items()}))
    if result['orientation'] is None:result['orientation']=1
    raw=result['raw_exif'];origins={key:'original' for key,value in result.items() if key!='raw_exif' and value is not None}
    original_orientation=any(k.split()[-1].split(':')[-1]=='Orientation' for k in raw)
    if not original_orientation:origins['orientation']='default'
    sources=[]
    if supplement and supplement.get('sha256')==source_hash:
        sources.append(('exiftool',supplement['tags']))
    packet=parse_xmp(embedded)
    if packet:sources.append(('xmp-embedded',packet))
    xmp_tags={}
    for sidecar in sidecars(path):
        record=read_xmp(sidecar)
        if not record:continue
        xmp_tags.update(record['tags'])
        raw['Sidecar:'+record['name']+':SHA256']=record['sha256']
    if xmp_tags:sources.append(('xmp-sidecar',xmp_tags))
    for name,tags in sources:
        for key,value in tags.items():
            # Structured/list XMP stays inspectable text; never assign Photo tags/rating.
            raw[name+':'+key]=json.dumps(value,ensure_ascii=False)[:4096] if isinstance(value,(dict,list)) else str(value)[:4096]
        for key,value in from_tags(tags).items():
            if value is not None and (result.get(key) is None or (key=='orientation' and origins.get(key)=='default' and not original_orientation)):
                result[key]=value;origins[key]=name
    raw['PhotoCollection:MetadataSources']=json.dumps(origins,ensure_ascii=False,sort_keys=True)
    return result
