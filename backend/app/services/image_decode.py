"""Versioned display pixels. Old watermark drafts retain their legacy decoder.

Decode on a background import worker or the isolated display process, never in
the WebView. Originals are opened read-only; EXIF is consumed, not rewritten.
"""
from io import BytesIO
from pathlib import Path
from PIL import Image, ImageOps, ImageCms
from pillow_heif import register_heif_opener

DISPLAY_DECODE_VERSION = 'pc-display-2'
MAX_PIXELS = 100_000_000


def srgb_profile():
    return ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()


def display_image(path: Path | str, *, alpha: bool = False) -> Image.Image:
    register_heif_opener()
    with Image.open(path) as source:
        if source.width * source.height > MAX_PIXELS:
            raise ValueError('Image exceeds the 100 megapixel limit.')
        source.load()
        image = ImageOps.exif_transpose(source)
        try:
            # Palette transparency and grayscale alpha must survive ICC conversion.
            has_alpha = 'A' in image.getbands() or 'transparency' in image.info
            mask = image.convert('RGBA').getchannel('A') if has_alpha else None
            try:
                if image.mode.startswith('I;16'):
                    import numpy as np
                    scaled = ((np.asarray(image, dtype=np.uint16).astype(np.uint32) + 128) // 257).astype(np.uint8)
                    color = Image.fromarray(scaled)
                else:
                    color = image.convert('RGB') if has_alpha or image.mode == 'P' else image.copy()
                try:
                    icc = source.info.get('icc_profile')
                    if icc:
                        try:
                            converted = ImageCms.profileToProfile(color, ImageCms.ImageCmsProfile(BytesIO(icc)), ImageCms.createProfile('sRGB'), outputMode='RGB')
                            color.close(); color = converted
                        except (ValueError, OSError, ImageCms.PyCMSError):
                            # Broken or mismatched profiles cannot abort the whole import.
                            pass
                    rgb = color.convert('RGB')
                    if mask is not None:
                        if alpha:
                            rgb.putalpha(mask)
                        else:
                            white = Image.new('RGB', rgb.size, 'white')
                            white.paste(rgb, mask=mask); rgb.close(); rgb = white
                    # Derived display images carry only a standardized color profile.
                    rgb.info.clear(); rgb.info['icc_profile'] = srgb_profile()
                    return rgb
                finally:
                    color.close()
            finally:
                if mask is not None: mask.close()
        finally:
            image.close()
