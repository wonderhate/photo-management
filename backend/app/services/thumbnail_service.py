from io import BytesIO
from pathlib import Path
from PIL import Image, ImageOps, ImageCms
from pillow_heif import register_heif_opener
from ..config import DATA, RAW_EXTENSIONS, settings

register_heif_opener()

def open_image(path: Path) -> Image.Image:
    if path.suffix.lower() in RAW_EXTENSIONS:
        import rawpy
        with rawpy.imread(str(path)) as raw:
            try:
                thumb = raw.extract_thumb()
                im = Image.open(BytesIO(thumb.data)) if thumb.format == rawpy.ThumbFormat.JPEG else Image.fromarray(thumb.data)
                return ImageOps.exif_transpose(im).convert('RGB')
            except (rawpy.LibRawNoThumbnailError, rawpy.LibRawUnsupportedThumbnailError):
                return Image.fromarray(raw.postprocess(use_camera_wb=True, half_size=True, output_bps=8))
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
    im = open_image(path)
    result = {'width': im.width, 'height': im.height}
    for folder, edge, quality in [('previews', 2560, 90), ('thumbnails', 560, settings()['thumbnail_quality'])]:
        copy = im.copy()
        copy.thumbnail((edge, edge), Image.Resampling.LANCZOS)
        target = DATA / folder / f'{photo_id}.jpg'
        copy.save(target, 'JPEG', quality=quality)
        result['preview_path' if folder == 'previews' else 'thumbnail_path'] = str(target)
    return result
