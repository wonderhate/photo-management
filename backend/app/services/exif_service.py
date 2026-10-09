from datetime import datetime
from fractions import Fraction
from pathlib import Path
from typing import Any
import math
import exifread
from PIL import Image, ExifTags

def number(value: Any) -> float | None:
    try:
        if hasattr(value, 'values'):
            value = value.values
        if isinstance(value, (list, tuple)):
            value = value[0]
        if hasattr(value, 'num') and hasattr(value, 'den'):
            result = float(value.num) / value.den
        else:
            result = float(Fraction(str(value).strip()))
        return result if math.isfinite(result) else None
    except (ValueError, ZeroDivisionError, TypeError, IndexError):
        return None

def shutter(seconds: float | None) -> str | None:
    if not seconds or seconds <= 0:
        return None
    return f'1/{round(1 / seconds)}' if seconds < 1 else f'{seconds:g}'

def date_string(value: Any) -> str | None:
    if not value:
        return None
    text = str(value).strip()
    for fmt in ('%Y:%m:%d %H:%M:%S', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%d %H:%M:%S'):
        try:
            return datetime.strptime(text[:19], fmt).isoformat()
        except ValueError:
            pass
    return None

def gps(values: Any, ref: str) -> float | None:
    if hasattr(values, 'values'):
        values = values.values
    try:
        d, m, s = [number(v) for v in values]
        result = d + m / 60 + s / 3600
        return -result if str(ref) in ('S', 'W') else result
    except (TypeError, ValueError):
        return None

def extract(path: Path) -> dict:
    tags: dict[str, Any] = {}
    try:
        with path.open('rb') as stream:
            tags = exifread.process_file(stream, details=False, strict=False)
    except Exception:
        pass
    raw = {key: str(value) for key, value in tags.items() if key not in ('JPEGThumbnail', 'TIFFThumbnail')}
    def get(name: str) -> Any:
        return tags.get('EXIF ' + name, tags.get('Image ' + name))
    width, height = number(get('ExifImageWidth')), number(get('ExifImageLength'))
    orientation = number(get('Orientation'))
    try:
        with Image.open(path) as im:
            width, height = im.size
            exif = im.getexif()
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
        result = str(value).strip().strip('\x00')
        return result or None
    seconds = number(get('ExposureTime'))
    iso = number(get('ISOSpeedRatings')) or number(get('PhotographicSensitivity'))
    gps_altitude = number(tags.get('GPS GPSAltitude'))
    gps_altitude_ref = str(tags.get('GPS GPSAltitudeRef', '0'))
    if gps_altitude is not None and gps_altitude_ref == '1':
        gps_altitude = -gps_altitude
    return {
        'width': int(width) if width else None, 'height': int(height) if height else None,
        'orientation': int(orientation) if orientation else 1,
        'camera_make': text('Make'), 'camera_model': text('Model'), 'lens_model': text('LensModel'),
        'date_taken': date_string(get('DateTimeOriginal') or get('DateTimeDigitized')),
        'f_number': number(get('FNumber')), 'exposure_seconds': seconds, 'exposure_time': shutter(seconds),
        'iso': int(iso) if iso else None, 'focal_length': number(get('FocalLength')),
        'focal_length_35mm': number(get('FocalLengthIn35mmFilm')),
        'gps_latitude': gps(tags.get('GPS GPSLatitude'), str(tags.get('GPS GPSLatitudeRef', 'N'))),
        'gps_longitude': gps(tags.get('GPS GPSLongitude'), str(tags.get('GPS GPSLongitudeRef', 'E'))),
        'gps_altitude': gps_altitude,
        'raw_exif': raw,
    }
