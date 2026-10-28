"""Convert the public-domain Natural Earth 1:110m land shapefile to local SVG paths.

Usage: python frontend/scripts/prepare-map-land.py path/to/ne_110m_land.zip
No GIS dependency, network access, geographic names or administrative borders.
"""
import hashlib
import json
from pathlib import Path
import struct
import sys
import zipfile

source=Path(sys.argv[1]);public=Path(__file__).resolve().parents[1]/'public'
with zipfile.ZipFile(source) as archive:
    shape=archive.read('ne_110m_land.shp')
    version=archive.read('ne_110m_land.VERSION.txt').decode().strip()
paths=[];offset=100
while offset<len(shape):
    _,length=struct.unpack_from('>2i',shape,offset);offset+=8
    record=memoryview(shape)[offset:offset+length*2];offset+=length*2
    kind=struct.unpack_from('<i',record)[0]
    if kind==0:continue
    if kind!=5:raise ValueError('Expected polygon data')
    parts,count=struct.unpack_from('<2i',record,36)
    starts=list(struct.unpack_from('<'+str(parts)+'i',record,44))+[count]
    points=[struct.unpack_from('<2d',record,44+parts*4+i*16) for i in range(count)]
    fmt=lambda n:f'{n:.3f}'.rstrip('0').rstrip('.')
    paths.append(''.join('M'+'L'.join(fmt(lon+180)+','+fmt(90-lat) for lon,lat in points[start:end])+'Z' for start,end in zip(starts,starts[1:])))
folder=public/'maps';folder.mkdir(exist_ok=True)
(folder/'land-110m.json').write_text(json.dumps(dict(version=1,paths=paths),separators=(',',':')),encoding='utf-8')
(public/'licenses'/'natural-earth-land.json').write_text(json.dumps(dict(name='Natural Earth 1:110m land',version=version,license='Public domain',authors=['Tom Patterson','Nathaniel Vaughn Kelso','Natural Earth contributors'],source='https://naturalearth.s3.amazonaws.com/110m_physical/ne_110m_land.zip',source_page='https://www.naturalearthdata.com/downloads/110m-physical-vectors/110m-land/',terms='https://www.naturalearthdata.com/about/terms-of-use/',sha256=hashlib.sha256(source.read_bytes()).hexdigest(),conversion='Polygon coordinates rounded to 0.001 degrees; equirectangular SVG path data. No administrative boundaries or place labels.'),indent=2)+'\n',encoding='utf-8')
