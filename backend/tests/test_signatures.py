from hashlib import sha256
from io import BytesIO
from PIL import Image
from backend.app.schemas import WatermarkOptions
from backend.app.watermark import frame_renderer, ambient_renderer
from backend.app.watermark.signatures import signature_image, ASSETS, FONTS
from backend.tests.test_library import import_paths

def test_signature_styles_alpha_geometry_and_visibility():
    photo = {'file_name':'test.jpg','camera_make':'TEST','camera_model':'CAMERA'}
    source = Image.new('RGB', (960,640), (38,72,96))
    options = WatermarkOptions(fields=['signature'], signature='wonder').model_dump()
    artworks = []
    for style in ['natural','fine','brush','calligraphy']:
        values = options | {'signature_style':style}
        art = signature_image(values)
        assert art.mode == 'RGBA' and art.getchannel('A').getextrema() == (0,255)
        artworks.append(sha256(art.tobytes()).hexdigest())
        assert frame_renderer.info_lines(photo, values)[0] == []
        rendered = frame_renderer.render(source, photo, values)
        assert rendered.crop((0,0,960,640)).tobytes() == source.tobytes()
        assert rendered.size == frame_renderer.render(source, photo, options).size
        assert rendered.crop((38,650,460,rendered.height-5)).convert('L').getextrema()[0] < 60
        for renderer, extra in [(frame_renderer, {'style':'classic_frame','theme':'black'}), (ambient_renderer,{})]:
            output = renderer.render(source, photo, values | extra)
            assert output.tobytes() != renderer.render(source, photo, values | extra | {'signature_style':'text'}).tobytes()
        hidden = values | {'fields':[]}
        assert signature_image(hidden) is None
        assert frame_renderer.render(source, photo, hidden).tobytes() == frame_renderer.render(source, photo, hidden | {'signature_style':'text'}).tobytes()
    assert len(set(artworks)) == 4
    assert frame_renderer.info_lines(photo, options)[0] == ['wonder']
    assert signature_image(options | {'signature_style':'fine','signature':'Mira'}).tobytes() != signature_image(options | {'signature_style':'fine'}).tobytes()
    assert signature_image(options | {'signature_style':'fine','signature':'摄影'}).getchannel('A').getbbox()
    for name in ['alexbrush','sacramento','kaushanscript']:
        assert 'SIL OPEN FONT LICENSE Version 1.1' in (ASSETS / (name+'-OFL.txt')).read_text()

def test_chinese_signatures_have_distinct_editable_glyphs_and_preserve_uncommon_names():
    source = Image.new('RGB', (960,640), (38,72,96))
    photo = {'file_name':'test.jpg'}
    for text in ['陈曦', '王小美 · wonder']:
        options = WatermarkOptions(fields=['signature'], signature=text).model_dump()
        regular = signature_image(options | {'signature_style':'fine'})
        artworks = []
        for style in [key for key in FONTS if key.startswith('chinese_')]:
            values = options | {'signature_style':style}
            art = signature_image(values)
            assert art.mode == 'RGBA' and art.getchannel('A').getextrema() == (0,255)
            assert art.tobytes() != regular.tobytes()
            assert art.tobytes() != signature_image(values | {'signature':'李明'}).tobytes()
            artworks.append(sha256(art.tobytes()).hexdigest())
            for renderer in [frame_renderer, ambient_renderer]:
                assert renderer.render(source, photo, values).tobytes() != renderer.render(source, photo, options).tobytes()
            rare = options | {'signature':'龘'}
            assert signature_image(rare | {'signature_style':style}).tobytes() == signature_image(rare | {'signature_style':'fine'}).tobytes()
        assert len(set(artworks)) == 4
    for family in ['mashanzheng','zhimangxing','liujianmaocao','longcang']:
        assert 'SIL OPEN FONT LICENSE Version 1.1' in (ASSETS / (family+'-OFL.txt')).read_text()

def test_signature_draft_preview_export_and_validation(client, image_factory):
    path = image_factory(); import_paths(client,[path])
    photo = client.get('/api/photos').json()['photos'][0]
    assert client.post('/api/watermark/preview',json={'photo_id':photo['id'],'options':{'signature_style':'../bad'}}).status_code == 422
    assert client.get('/api/watermark/signatures/unknown').status_code == 422
    for style in ['natural', *FONTS]:
        response = client.get('/api/watermark/signatures/'+style)
        assert response.status_code == 200
        with Image.open(BytesIO(response.content)) as image:
            assert image.mode == 'RGBA' and image.getchannel('A').getbbox()
        settings = {'fields':['signature'],'signature_style':style,'signature':'陈曦 · wonder' if style.startswith('chinese_') else 'wonder','long_edge':0,'format':'png'}
        created = client.post('/api/watermark/drafts',json={'photo_id':photo['id'],'settings_json':settings})
        assert created.status_code == 201,created.text
        draft = created.json()
        restored = client.get('/api/watermark/drafts/'+draft['id']).json()
        assert restored['settings_json']['signature_style'] == style
        assert restored['settings_json']['signature'] == settings['signature']
        assert client.get(restored['preview_url']).status_code == 200
        exported = client.post('/api/watermark/drafts/'+draft['id']+'/export',json={})
        assert exported.status_code == 200,exported.text
        with Image.open(exported.json()['path']) as image:
            assert image.crop((24,485,290,image.height-2)).convert('L').getextrema()[0] < 60
