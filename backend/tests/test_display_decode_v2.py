from hashlib import sha256
from PIL import Image, ImageCms
import numpy as np
from backend.app.services.image_decode import display_image
from backend.app.services.thumbnail_service import open_image


def test_display_icc_keeps_alpha_until_white_composite(tmp_path):
    path=tmp_path/'alpha.tiff'
    Image.new('RGBA',(60,40),(200,30,10,0)).save(path,icc_profile=ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())
    before=sha256(path.read_bytes()).hexdigest()
    with display_image(path) as image:
        assert image.getpixel((10,10))==(255,255,255)
        assert image.info.get('icc_profile')
    with display_image(path,alpha=True) as image:
        assert image.mode=='RGBA' and image.getpixel((10,10))[3]==0
    assert sha256(path.read_bytes()).hexdigest()==before


def test_display_16bit_full_range_without_changing_legacy_watermark_decoder(tmp_path):
    path=tmp_path/'gray.tiff'
    Image.fromarray(np.array([[0,32768,65535]],dtype=np.uint16)).save(path)
    before=sha256(path.read_bytes()).hexdigest()
    with display_image(path) as image:
        assert list(image.getdata())==[(0,0,0),(128,128,128),(255,255,255)]
    with open_image(path) as legacy:
        assert legacy.getpixel((1,0))==(255,255,255)
    assert sha256(path.read_bytes()).hexdigest()==before


def test_palette_transparency_and_broken_icc_are_isolated(tmp_path):
    path=tmp_path/'palette.png'
    image=Image.new('P',(30,20),0);image.putpalette([255,0,0]+[0]*765)
    image.save(path,transparency=0,icc_profile=b'broken-profile')
    before=sha256(path.read_bytes()).hexdigest()
    with display_image(path) as result:
        assert result.getpixel((0,0))==(255,255,255)
    assert sha256(path.read_bytes()).hexdigest()==before


def test_heic_and_tiff_orientation_and_profiles_leave_sources_unchanged(tmp_path):
    from pillow_heif import register_heif_opener
    register_heif_opener()
    profile=ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
    for extension,format in [('heic','HEIF'),('tiff','TIFF')]:
        path=tmp_path/('portrait.'+extension);exif=Image.Exif();exif[274]=6
        with Image.new('RGB',(80,40),(190,80,40)) as image:image.save(path,format=format,exif=exif.tobytes(),icc_profile=profile)
        before=sha256(path.read_bytes()).hexdigest()
        with display_image(path) as image:
            assert image.size==(40,80) and image.mode=='RGB' and image.info.get('icc_profile')
        assert sha256(path.read_bytes()).hexdigest()==before
