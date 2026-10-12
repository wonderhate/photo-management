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
        assert rendered.crop((336,640,624,rendered.height)).convert('L').getextrema()[0] < 60
        for renderer, extra in [(frame_renderer, {'style':'classic_frame','theme':'black'}), (ambient_renderer,{})]:
            output = renderer.render(source, photo, values | extra)
            assert output.tobytes() != renderer.render(source, photo, values | extra | {'signature_style':'text'}).tobytes()
        hidden = values | {'fields':[]}
        assert signature_image(hidden) is None
        assert frame_renderer.render(source, photo, hidden).tobytes() == frame_renderer.render(source, photo, hidden | {'signature_style':'text'}).tobytes()
    assert len(set(artworks)) == 4
    assert frame_renderer.info_lines(photo, options)[0] == []
    assert signature_image(options).getchannel('A').getbbox()
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
            assert image.crop((round(image.width*.35),485,round(image.width*.65),image.height-2)).convert('L').getextrema()[0] < 60

def test_signature_is_centered_beside_logo_and_inside_ambient_frame(monkeypatch):
    artwork = Image.new('RGBA', (38,22), (0,0,0,255))
    monkeypatch.setattr(frame_renderer, 'signature_image', lambda options: artwork)
    monkeypatch.setattr(ambient_renderer, 'signature_image', lambda options: artwork)
    monkeypatch.setattr(frame_renderer, 'load_logo', lambda make: Image.new('RGBA', (100,100), (220,0,180,255)))
    photo = {'file_name':'sample.jpg','camera_make':'Nikon','camera_model':'Z 8',
        'focal_length':50,'f_number':1.8,'exposure_time':'1/125','iso':100}
    options = WatermarkOptions(fields=['camera_make','camera_model','focal_length','f_number','exposure_time','iso','signature'], signature='摄影').model_dump()
    for width, height in [(1920,1080),(800,1200),(2000,500)]:
        source = Image.new('RGB', (width,height), (40,40,40))
        modern = frame_renderer.render(source, photo, options)
        ink = [(x,y) for y in range(height,modern.height) for x in range(round(width*.35),round(width*.64)) if modern.getpixel((x,y)) == (17,17,17)]
        assert ink and abs((min(x for x,y in ink)+max(x for x,y in ink))/2-width/2) <= 1
        assert abs((min(y for x,y in ink)+max(y for x,y in ink))/2-(height+modern.height)/2) <= 1
        logo = [(x,y) for y in range(height,modern.height) for x in range(round(width*.6),round(width*.72)) if modern.getpixel((x,y)) == (220,0,180)]
        assert logo and max(x for x,y in ink) < min(x for x,y in logo)
        assert modern.crop((0,0,width,height)).tobytes() == source.tobytes()
        ambient = ambient_renderer.render(source, photo, options)
        border = round(min(width,height)*(1-options['photo_scale'])/2)
        footer_y = height+border*2
        padding = max(8,round(min(width,height)*.022))
        ink = [(x,y) for y in range(footer_y,ambient.height) for x in range(round(ambient.width*.34),round(ambient.width*.66)) if ambient.getpixel((x,y)) == (244,244,238)]
        assert ink and abs((min(x for x,y in ink)+max(x for x,y in ink))/2-ambient.width/2) <= 1
        assert abs((min(y for x,y in ink)+max(y for x,y in ink))/2-(footer_y+ambient.height-padding)/2) <= 1
        footer = ambient.crop((0,footer_y,ambient.width,ambient.height))
        assert all(color != (155,163,165) for count,color in footer.getcolors(footer.width*footer.height))

def test_old_signature_previews_refresh_without_changing_draft_or_losing_offline_preview(client, image_factory):
    from pathlib import Path
    from backend.app.models import Session, WatermarkDraft
    path = image_factory(); import_paths(client,[path])
    photo = client.get('/api/photos').json()['photos'][0]
    for template in ['frame','ambient']:
        settings = {'template':template,'fields':['signature'],'signature':'摄影','signature_style':'chinese_running'}
        draft = client.post('/api/watermark/drafts',json={'photo_id':photo['id'],'settings_json':settings}).json()
        with Session() as session:
            saved = session.get(WatermarkDraft,draft['id'])
            old = Path(saved.preview_path).with_name(saved.id+'-'+template+'-old.webp')
            Path(saved.preview_path).rename(old); saved.preview_path = str(old); session.commit()
        assert client.get(draft['preview_url']).status_code == 200
        updated = client.get('/api/watermark/drafts/'+draft['id']).json()
        assert 'centered-signature' in updated['preview_path'] and not old.exists()
        assert updated['revision'] == draft['revision'] and updated['settings_json'] == draft['settings_json']
    path.unlink()
    preview = Path(updated['preview_path'])
    before = preview.read_bytes()
    with Session() as session:
        saved = session.get(WatermarkDraft,updated['id'])
        old = preview.with_name(saved.id+'-offline-old.webp')
        preview.rename(old); saved.preview_path = str(old); session.commit()
    assert client.get(updated['preview_url']).status_code == 200
    assert old.read_bytes() == before
