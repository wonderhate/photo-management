from pathlib import Path
from typing import Any
import exifread
from PIL import Image, ExifTags, ImageCms
from .metadata_values import number, shutter, date_string, gps

def extract(path: Path, *, include_xmp=False) -> dict:
    tags: dict[str, Any] = {}
    try:
        with path.open('rb') as stream:
            tags = exifread.process_file(stream, details=False, strict=False)
    except Exception:
        pass
    raw = {key: str(value) for key, value in tags.items() if key not in ('JPEGThumbnail', 'TIFFThumbnail')}
    def get(name: str) -> Any:
        return tags.get('EXIF ' + name, tags.get('Image ' + name))
    width, height = number(get('ExifImageWidth')), number(get('ExifImageLength'));embedded=None
    orientation = number(get('Orientation'))
    try:
        with Image.open(path) as im:
            width, height = im.size
            profile=im.info.get('icc_profile')
            if profile and len(profile)<=4*1024*1024:
                try:
                    from io import BytesIO
                    raw['ICC:ProfileDescription']=ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(BytesIO(profile))).strip()[:4096]
                except (OSError,ValueError,ImageCms.PyCMSError):pass
            exif = im.getexif()
            if include_xmp:
                packet=im.info.get('xmp') or exif.get(700)
                if isinstance(packet,(bytes,str)) and len(packet)<=1024*1024:embedded=packet
            entries = dict(exif)
            try:
                entries.update(exif.get_ifd(34665))
            except (KeyError, TypeError):
                pass
            for key, value in entries.items():
                name = ExifTags.TAGS.get(key, str(key))
                raw.setdefault(name, str(value))
                if get(name) is None:
                    tags['EXIF ' + name] = value
            orientation = number(get('Orientation')) or orientation
            gps_ifd = exif.get_ifd(34853)
            for key, value in gps_ifd.items():
                tags.setdefault('GPS ' + ExifTags.GPSTAGS.get(key, str(key)), value)
    except Exception:
        pass
    def text(name: str) -> str | None:
        value = get(name)
        if value is None:
            return None
        result = str(value).replace('\x00','').strip()
        return result or None
    seconds = number(get('ExposureTime'))
    iso = number(get('ISOSpeedRatings')) or number(get('PhotographicSensitivity'))
    gps_altitude = number(tags.get('GPS GPSAltitude'))
    gps_altitude_ref = str(tags.get('GPS GPSAltitudeRef', '0'))
    if gps_altitude is not None and gps_altitude_ref == '1':
        gps_altitude = -gps_altitude
    result={
        'width': int(width) if width else None, 'height': int(height) if height else None,
        'orientation': int(orientation) if orientation else 1,
        'camera_make': text('Make'), 'camera_model': text('Model'), 'lens_model': text('LensModel'),
        'date_taken': date_string(get('DateTimeOriginal') or get('DateTimeDigitized')),
        'f_number': number(get('FNumber')), 'exposure_seconds': seconds, 'exposure_time': shutter(seconds),
        'iso': int(iso) if iso else None, 'focal_length': number(get('FocalLength')),
        'focal_length_35mm': number(get('FocalLengthIn35mmFilm')),
        'gps_latitude': gps(tags.get('GPS GPSLatitude'), tags.get('GPS GPSLatitudeRef', ''),90),
        'gps_longitude': gps(tags.get('GPS GPSLongitude'), tags.get('GPS GPSLongitudeRef', ''),180),
        'gps_altitude': gps_altitude,
        'raw_exif': raw,
    }
    if include_xmp:result['_embedded_xmp']=embedded
    return result
