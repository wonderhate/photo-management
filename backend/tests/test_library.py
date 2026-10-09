import hashlib
import time
from io import BytesIO
from pathlib import Path
import numpy as np
import pytest
from PIL import Image, TiffImagePlugin
from sqlalchemy import select
from backend.app.config import DATA
from backend.app.models import Session, Photo, CaptureGroup
from backend.app.services.exif_service import number, shutter, extract, date_string
from backend.app.services.embedding_service import similarity_scores
from backend.app.schemas import WatermarkOptions

def wait_job(client, job):
    for _ in range(400):
        result=client.get('/api/jobs/'+job['id']).json()
        if result['status'] in ('completed','failed'):
            assert result['status']=='completed', result
            return result
        time.sleep(.025)
    pytest.fail('background job timed out')

def import_paths(client, paths):
    response=client.post('/api/photos/import',json={'paths':[str(p) for p in paths]})
    assert response.status_code==202, response.text
    return wait_job(client,response.json())

@pytest.mark.parametrize('value,expected',[('28/10',2.8),('1/500',.002),('850/10',85),('0/0',None),('NaN',None),([100],100),(None,None)])
def test_rationals(value,expected): assert number(value)==expected

def test_exif(image_factory):
    path=image_factory()
    values=extract(path)
    assert values['f_number']==2.8
    assert values['exposure_time']=='1/500'
    assert values['exposure_seconds']==.002
    assert values['focal_length']==85
    assert values['iso']==100
    assert values['camera_model']=='ILCE-7M4'
    assert values['lens_model']=='FE 85mm F1.4 GM'
    assert values['date_taken']=='2026-09-29T18:24:00'
    assert values['raw_exif']

def test_import_duplicate_missing_exif_corrupt_and_safe_delete(client,image_factory,tmp_path):
    original=image_factory()
    digest=hashlib.sha256(original.read_bytes()).hexdigest()
    blank=tmp_path/'plain.png';Image.new('RGB',(45,90),'blue').save(blank)
    broken=tmp_path/'broken.jpg';broken.write_bytes(b'not a photo')
    first=import_paths(client,[original,blank,broken])
    assert (first['success'],first['failed'])==(2,1)
    repeated=import_paths(client,[original]);assert repeated['skipped']==1
    listing=client.get('/api/photos').json();assert listing['total']==2
    photo=next(p for p in listing['photos'] if p['file_name']==original.name)
    assert client.get(photo['thumbnail_url']).status_code==200
    assert client.patch('/api/photos/'+photo['id'],json={'favorite':True,'tags':['旅行','日落']}).status_code==200
    assert client.get('/api/photos?favorite=true').json()['total']==1
    assert client.get('/api/photos?tag=旅行').json()['total']==1
    assert client.delete('/api/photos/'+photo['id']).json()['originals_untouched']
    assert original.exists() and hashlib.sha256(original.read_bytes()).hexdigest()==digest

def test_raw_pairing_counts_and_never_pair_same_time_bursts(client,image_factory,tmp_path):
    # Invalid RAW stand-ins exercise the required metadata-only failure path, not RAW decoding.
    paths=[]
    for index in range(2):
        jpeg=image_factory(f'DSC{index:04}.jpg',day=20+index)
        raw=tmp_path/f'DSC{index:04}.ARW';raw.write_bytes(f'unsupported raw {index}'.encode())
        paths += [raw,jpeg]
    different=tmp_path/'OTHER.ARW';different.write_bytes(b'burst: different filename')
    result=import_paths(client,paths);assert result['success']==4
    listing=client.get('/api/photos').json();assert listing['total']==2
    assert all(len(p['files'])==2 and not p['is_raw'] for p in listing['photos'])
    assert client.get('/api/stats?count_mode=capture').json()['summary']['total']==2
    assert client.get('/api/stats?count_mode=file').json()['summary']['total']==4
    report=client.get('/api/reports/yearly/2026').json()
    assert report['summary']['captures']==2 and report['summary']['files']==4
    assert client.get('/api/photos?file_type=paired').json()['total']==2
    import_paths(client,[different]);assert client.get('/api/photos').json()['total']==3
    ids=[p['id'] for p in listing['photos']]
    client.delete('/api/photos/'+ids[0]);assert all(p.exists() for p in paths)

def test_reports_click_filters_and_100_photo_import(client,image_factory):
    paths=[]
    for index in range(100):
        paths.append(image_factory(f'photo-{index:03}.jpg',lens=['35mm Prime','85mm Prime','24-70 Zoom'][index%3],focal=[24,35,50,85][index%4],month=index%12+1,day=index%28+1,color=(index,30,100)))
    assert import_paths(client,paths)['success']==100
    assert len(client.get('/api/photos?page_size=20').json()['photos'])==20
    assert client.get('/api/photos?focal_length=85').json()['total']==25
    stats=client.get('/api/stats/focal-length?mode=exact').json()
    bin85=next(row for row in stats if row['label']=='85 mm')
    assert bin85['count']==25
    assert client.get('/api/photos',params=bin85['filter']).json()['total']==25
    yearly=client.get('/api/reports/yearly/2026').json()
    assert yearly['summary']['captures']==100 and yearly['summary']['files']==100
    assert len(yearly['lenses'])==3
    assert sum(row['count'] for row in yearly['timeline'])==100
    monthly=client.get('/api/reports/monthly/2026/9').json()
    assert monthly['summary']['total']==8
    lens=client.get('/api/reports/lenses/24-70 Zoom/yearly?year=2026').json()
    assert sum(b['count'] for b in lens['zoom'])<=lens['summary']['total']
    assert client.get('/api/reports/lenses/24-70 Zoom').json()['total']==33

def test_album_and_original_move_reimport(client,image_factory,tmp_path):
    path=image_factory();import_paths(client,[path])
    photo=client.get('/api/photos').json()['photos'][0]
    album=client.post('/api/albums',json={'name':'旅行','photo_ids':[photo['id']]}).json()
    assert client.get('/api/photos',params={'album_id':album['id']}).json()['total']==1
    client.delete('/api/albums/'+album['id']);assert path.exists()
    moved=tmp_path/'relocated.jpg';path.rename(moved)
    assert client.get('/api/photos/'+photo['id']).json()['missing']
    import_paths(client,[moved])
    assert not client.get('/api/photos/'+photo['id']).json()['missing']
    assert client.get('/api/photos').json()['total']==1

def test_watermark_preview_exports_preserve_original_and_adapt_colors(client,image_factory):
    paths=[image_factory('warm.jpg',color=(210,80,20)),image_factory('cool.jpg',color=(10,50,210))]
    digests={p:hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
    import_paths(client,paths)
    photos=client.get('/api/photos').json()['photos']
    opts=WatermarkOptions(long_edge=800).model_dump()
    for template in ['frame','ambient']:
        opts['template']=template
        responses=[]
        for photo in photos:
            response=client.post('/api/watermark/preview',json={'photo_id':photo['id'],'options':opts})
            assert response.status_code==200,response.text[:200]
            image=Image.open(BytesIO(response.content));assert image.width>0
            responses.append(np.array(image))
            exported=client.post('/api/watermark/export',json={'photo_id':photo['id'],'options':opts}).json()
            assert Path(exported['path']).parent==DATA/'exports'
            assert max(exported['width'],exported['height'])<=800
        assert not np.array_equal(responses[0],responses[1])
        if template=='ambient':
            # The two photos must produce different actual environmental colors.
            assert np.abs(responses[0][0,0].astype(float)-responses[1][0,0].astype(float)).sum()>50
    second=client.post('/api/watermark/export',json={'photo_id':photos[0]['id'],'options':opts}).json()
    assert '_2.' in second['file_name']
    batch=client.post('/api/watermark/batch-export',json={'photo_ids':[p['id'] for p in photos],'options':{**opts,'format':'png'}})
    assert wait_job(client,batch.json())['success']==2
    for path,digest in digests.items(): assert hashlib.sha256(path.read_bytes()).hexdigest()==digest

def test_and_or_cosine_semantics():
    images=np.array([[1,0],[0,1],[1,1]],dtype=float)
    texts=np.array([[1,0],[0,1]],dtype=float)
    assert np.argmax(similarity_scores(images,texts,'all'))==2
    assert similarity_scores(images,texts,'any')[0]==1

def test_origin_protection_and_unknown_jobs(client):
    assert client.post('/api/backup',headers={'Origin':'https://untrusted.example'}).status_code==403
    assert client.get('/api/jobs/missing').status_code==404
    assert client.get('/api/photos?page=0').status_code==400
    assert client.post('/api/albums',json={'name':'  '}).status_code==422

def test_heic_and_orientation(client,image_factory,tmp_path):
    import pillow_heif
    exif=Image.Exif();exif[274]=6
    rotated=tmp_path/'rotated.jpg'
    Image.new('RGB',(90,40),'red').save(rotated,exif=exif)
    heic=tmp_path/'test.heic'
    pillow_heif.from_pillow(Image.new('RGB',(60,80),'green')).save(heic)
    result=import_paths(client,[rotated,heic])
    assert result['success']==2,result
    photos=client.get('/api/photos').json()['photos']
    rotation=next(p for p in photos if p['file_name']=='rotated.jpg')
    assert (rotation['width'],rotation['height'])==(40,90)
    assert client.get('/api/photos?orientation=portrait').json()['total']==2
    for photo in photos: assert client.get(photo['preview_url']).status_code==200

def test_watermark_fields_hidden_and_missing_exif():
    from backend.app.watermark.common import lines
    values={'camera_model':'Sony A7 IV','lens_model':'FE 85mm F1.4 GM','focal_length':85,'f_number':1.4,'exposure_time':'1/500','iso':100}
    options=WatermarkOptions(template='ambient').model_dump()
    headings,params=lines(values,options)
    assert values['lens_model'] in headings and 'ISO 100' in params
    options['fields']=[f for f in options['fields'] if f not in ('lens_model','iso')]
    headings,params=lines(values,options)
    assert values['lens_model'] not in headings and not any('ISO' in p for p in params)
    assert lines({},options)==([],[])
