from io import BytesIO
from pathlib import Path
from PIL import Image, ImageOps, ImageCms
from pillow_heif import register_heif_opener
from ..config import DATA, RAW_EXTENSIONS, settings
from .image_decode import display_image, srgb_profile

register_heif_opener()

def open_image(path: Path) -> Image.Image:
    if path.suffix.lower() in RAW_EXTENSIONS:
        from .raw_preview_worker import decode
        return decode(path)[0]
    with Image.open(path) as source:
        source.load()
        im = ImageOps.exif_transpose(source)
        profile = source.info.get('icc_profile')
        if profile:
            try:
                im = ImageCms.profileToProfile(im, ImageCms.ImageCmsProfile(BytesIO(profile)), ImageCms.createProfile('sRGB'), outputMode='RGB')
            except (ValueError, OSError, ImageCms.PyCMSError):
                pass
        if im.mode in ('RGBA', 'LA'):
            base = Image.new('RGB', im.size, 'white')
            base.paste(im.convert('RGB'), mask=im.getchannel('A'))
            return base
        return im.convert('RGB')

def generate(path: Path, photo_id: str) -> dict:
    if path.suffix.lower() in RAW_EXTENSIONS:
        from .raw_preview_worker import decode
        image,info=decode(path)
    else:
        image=display_image(path);info={'width':image.width,'height':image.height}
    with image as im:
        result = {key:info[key] for key in ('width','height')}
        for folder, edge, quality in [('previews', 2560, 90), ('thumbnails', 560, settings()['thumbnail_quality'])]:
            with im.copy() as copy:
                copy.thumbnail((edge, edge), Image.Resampling.LANCZOS)
                target = DATA / folder / f'{photo_id}-display2.jpg'
                copy.save(target, 'JPEG', quality=quality, icc_profile=srgb_profile())
                result['preview_path' if folder == 'previews' else 'thumbnail_path'] = str(target)
    return result
