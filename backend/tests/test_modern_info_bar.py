from io import BytesIO
from pathlib import Path
from PIL import Image
from backend.app.schemas import WatermarkOptions
from backend.app.watermark import frame_renderer, brand_logos
from backend.app.models import Session, WatermarkDraft
from backend.tests.test_library import import_paths

PHOTO = dict(file_name='night.jpg', camera_make='Nikon', camera_model='NIKON Z 7_2',
    focal_length=61, f_number=4, exposure_time='1/250', iso=1100, date_taken='2020-01-04T14:08:11')

def test_modern_geometry_metadata_logo_and_fallbacks(tmp_path, monkeypatch):
    options=WatermarkOptions().model_dump()
    image=Image.new('RGB',(1920,1280),(24,38,52))
    rendered=frame_renderer.render(image,PHOTO,options)
    assert rendered.size==(1920,1488)
    assert rendered.crop((0,0,1920,1280)).tobytes()==image.tobytes()
    assert rendered.getpixel((0,1300))==(255,255,255)
    left,right=frame_renderer.info_lines(PHOTO,options)
    assert left==['NIKON CORPORATION','NIKON Z 7_2']
    assert right==['61mm  F4  1/250s  ISO1100','2020-01-04 14:08:11']
    hidden=WatermarkOptions(show_iso=False,show_shutter=False,show_date=False).model_dump()
    assert frame_renderer.info_lines(PHOTO,hidden)[1]==['61mm  F4']
    assert frame_renderer.info_lines(PHOTO|{'camera_make':None},options)[0]==['NIKON Z 7_2']
    assert frame_renderer.info_lines({'file_name':'no-exif.jpg'},options)[0]==['no-exif']
    assert frame_renderer.info_lines(PHOTO,WatermarkOptions(fields=[]).model_dump())[0]==[]
    for make in ['NIKON CORPORATION','Canon Inc.','SONY','FUJIFILM','Leica Camera AG']:
        assert brand_logos.load_logo(make) is not None
    assert brand_logos.load_logo('Unknown Camera') is None
    assert rendered.tobytes()!=frame_renderer.render(image,PHOTO,options|{'show_brand_logo':False}).tobytes()
    # The occupied EXIF row stays vertically centered when its date is hidden.
    single=frame_renderer.render(image,PHOTO,options|{'fields':['focal_length','f_number']})
    pixels=[y for y in range(1280,1488) for x in range(1240,1850) if max(single.getpixel((x,y)))<100]
    assert pixels and abs((min(pixels)+max(pixels))/2-(1280+208/2))<2
    for size in [(800,1200),(400,400),(2000,500)]:
        output=frame_renderer.render(Image.new('RGB',size),PHOTO,options)
        assert output.width==size[0] and output.height>size[1]
    monkeypatch.setattr(brand_logos,'LOGO_DIR',tmp_path)
    assert frame_renderer.render(image,PHOTO,options).size==rendered.size

def test_legacy_draft_defaults_restore_preview_and_export(client,image_factory):
    path=image_factory();import_paths(client,[path]);photo=client.get('/api/photos').json()['photos'][0]
    for invalid in [{'info_height':'bad'}, {'info_height':-1}, {'fields':None}, {'fields':'iso'}]:
        assert client.post('/api/watermark/preview',json={'photo_id':photo['id'],'options':invalid}).status_code==422
    old={'template':'frame','info_height':.2,'font_size':1.4,'fields':['camera_model','focal_length','iso'],
        'signature':'旧署名','theme':'black','border':.1,'radius':.05,'long_edge':0,'format':'png',
        'quality':90,'filename_template':'modern_test'}
    create=client.post('/api/watermark/drafts',json={'photo_id':photo['id'],'settings_json':old}).json()
    # Emulate a pre-upgrade JSON record and an old cached preview.
    with Session() as session:
        draft=session.get(WatermarkDraft,create['id']);draft.settings_json=old
        previous=Path(draft.preview_path);classic=previous.with_name(draft.id+'-old.webp')
        previous.rename(classic);draft.preview_path=str(classic);session.commit()
    recovered=client.get('/api/watermark/drafts/'+create['id']).json()
    options=recovered['settings_json']
    assert options['style']=='modern_info_bar' and options['show_brand_logo']
    assert options['fields']==old['fields'] and options['font_scale']==1.4
    assert abs(options['info_bar_ratio']-1/6)<1e-6
    cached=client.get(recovered['preview_url']);assert cached.status_code==200
    after=client.get('/api/watermark/drafts/'+create['id']).json()
    assert '-modern_info_bar-' in after['preview_path'] and not classic.exists()
    assert after['revision']==recovered['revision']
    preview=client.post('/api/watermark/preview',json={'photo_id':photo['id'],'options':options})
    exported=client.post('/api/watermark/drafts/'+create['id']+'/export',json={})
    assert exported.status_code==200,exported.text
    with Image.open(BytesIO(preview.content)) as p, Image.open(exported.json()['path']) as e:
        assert p.size==e.size==(640,576)
        assert e.getpixel((0,0))!= (255,255,255) and e.getpixel((0,500))==(255,255,255)
    updated=client.put('/api/watermark/drafts/'+create['id'],json={'revision':after['revision'],
        'settings_json':options|{'show_brand_logo':False,'info_bar_ratio':.18}})
    assert updated.status_code==200,updated.text
    assert updated.json()['modified_since_export']
    restored=client.get('/api/watermark/drafts/'+create['id']).json()['settings_json']
    assert not restored['show_brand_logo'] and restored['info_bar_ratio']==.18
