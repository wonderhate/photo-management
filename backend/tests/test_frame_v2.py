import copy
import hashlib
import io
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image
from backend.app.frame_v2 import validate_frame, geometry, layers
from backend.app.schemas import WatermarkOptions
from backend.app.services import frame_batch, import_service, watermark_service
from backend.app.watermark import frame_v2_renderer

TEMPLATES = json.loads((Path(__file__).parents[1]/'app/assets/frame-templates.json').read_text('utf-8'))


def document(index=0):
    return dict(version=2,template=copy.deepcopy(TEMPLATES[index]),margin=1,text_scale=1,
                tokens={'camera_model':'测试相机 Camera','lens_model':'35mm lens','focal':'35mm','aperture':'f/2.8','shutter':'1/125s','iso':'ISO 200','author':'wonder','title':'山与海'},
                logo=None,logo_mode='none',logo_tone='original')


@pytest.mark.parametrize('size',[(640,480),(480,640),(1200,240)])
def test_all_22_frames_share_full_size_layout_for_preview_and_export(size):
    assert len(TEMPLATES)==22
    for index in range(22):
        doc=document(index);validate_frame(doc)
        full=layers(*size,doc);preview=layers(*size,doc,320)
        assert full['layers']==preview['layers']
        assert full['fullWidth']==preview['fullWidth'] and full['fullHeight']==preview['fullHeight']
        with Image.new('RGB',size,(80,130,180)) as source:
            with frame_v2_renderer.render(source,doc,320) as image:
                assert image.size==(preview['width'],preview['height'])
                assert max(image.size)<=320
                assert image.info['icc_profile']


def test_frame_rejects_invalid_snapshots_and_oversized_output():
    for patch in [{'version':3},{'margin':True},{'tokens':{'private-path':'x'}},{'logo_mode':'manual'}, {'template':{'id':'incomplete'}}]:
        with pytest.raises(ValueError):validate_frame(document()|patch)
    doc=document();doc['template']['canvas']['scrim']=None
    with pytest.raises(ValueError):validate_frame(doc)
    with pytest.raises(ValueError):geometry(10000,10000,document())
    assert max(geometry(10000,10000,document(),4096)['width'],geometry(10000,10000,document(),4096)['height'])<=4096


def test_frame_library_snapshot_survives_template_removal(client):
    doc=document()
    record=dict(version=2,id='frame-test',name='My frame',template=doc['template'],margin=1,text_scale=1)
    assert client.post('/api/frame-library/templates',json=record).status_code==201
    assert client.post('/api/frame-library/templates',json=record).status_code==201
    assert client.post('/api/frame-library/templates',json=record|{'name':'changed'}).status_code==409
    assert client.get('/api/frame-library').json()['templates']==[record]
    assert client.delete('/api/frame-library/templates/frame-test').status_code==200
    assert client.get('/api/frame-library').json()['templates']==[]
    validate_frame(doc)
    assert doc['template']==record['template']


def test_batch_tokens_refresh_per_photo_preserve_title_and_manual_logo():
    photo=SimpleNamespace(camera_make='DJI',camera_model='FC3411',lens_model='wide',date_taken='2026-10-20T10:00:00',file_name='one.jpg',focal_length=24,f_number=2.8,exposure_time='1/125',iso=200)
    doc=document();original=copy.deepcopy(doc)
    result=frame_batch.options_for(photo,{'template':'frame','frame_v2':doc},([{'make':'DJI','model':'FC3411','name':'My drone'}],[]))['frame_v2']
    assert doc==original and result['tokens']['camera_model']=='My drone'
    assert result['tokens']['title']==doc['tokens']['title'] and result['tokens']['author']==doc['tokens']['author']
    assert result['tokens']['file_name']=='one.jpg' and result['tokens']['focal']=='24mm'
    assert result['logo'] is None


def test_v1_output_pixels_unchanged_when_v2_is_absent(client,image_factory):
    source=image_factory('legacy.jpg');before=hashlib.sha256(source.read_bytes()).hexdigest()
    _,photo_id=import_service.import_one(source)
    from backend.app.models import Session,Photo
    with Session() as session:photo=session.get(Photo,photo_id)
    options=WatermarkOptions(format='png').model_dump()
    with watermark_service.render(photo,options) as expected:
        result=watermark_service.export_one(photo_id,options)
        with Image.open(result['path']) as actual:
            assert actual.size==expected.size and actual.tobytes()==expected.tobytes()
    assert hashlib.sha256(source.read_bytes()).hexdigest()==before


def test_logo_alpha_resampling_has_no_hidden_color_halo_and_manual_snapshot_wins():
    import base64
    pixels=Image.new('RGBA',(20,20),(0,255,0,0))
    for y in range(5,15):
        for x in range(5,15):pixels.putpixel((x,y),(255,0,0,255))
    stream=io.BytesIO();pixels.save(stream,'PNG');data=stream.getvalue();pixels.close()
    asset=dict(id='logo-personal',name='Personal',make='SONY',variant='both',source='Synthetic fixture',license='Test fixture',
               data_url='data:image/png;base64,'+base64.b64encode(data).decode(),width=20,height=20,sha256=hashlib.sha256(data).hexdigest())
    doc=document();doc.update(logo=asset,logo_mode='manual',logo_tone='original')
    doc['template']['elements']=[dict(type='logo',anchor=dict(region='bottom',h='center',v='center'),style=dict(size=.06))]
    with Image.new('RGB',(300,200),'white') as source:
        with frame_v2_renderer.render(source,doc) as rendered:
            assert any(r>g for r,g,b in rendered.getdata())
            assert all(r>=g and g==b for r,g,b in rendered.getdata())
        doc['logo_tone']='black'
        with frame_v2_renderer.render(source,doc) as rendered:
            assert all(r==g==b for r,g,b in rendered.getdata())
    photo=SimpleNamespace(camera_make='NIKON',camera_model='Z9',lens_model='',date_taken='',file_name='photo.jpg',focal_length=None,f_number=None,exposure_time=None,iso=None)
    batch=frame_batch.options_for(photo,{'template':'frame','frame_v2':doc},([],[]))
    assert batch['frame_v2']['logo']==asset
