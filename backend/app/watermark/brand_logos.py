"""Camera make aliases and local manufacturer assets, shared by frame rendering."""
from pathlib import Path
from PIL import Image, UnidentifiedImageError

LOGO_DIR = Path(__file__).resolve().parents[1] / 'assets' / 'brand_logos'
BRANDS = {
    'nikon': 'NIKON CORPORATION', 'canon': 'CANON INC.', 'sony': 'SONY CORPORATION',
    'fujifilm': 'FUJIFILM CORPORATION', 'leica': 'LEICA CAMERA AG',
}

def brand_key(make: str | None) -> str | None:
    normalized = (make or '').strip().casefold()
    return next((key for key in BRANDS if normalized == key or normalized.startswith(key + ' ')), None)

def display_name(make: str) -> str:
    return BRANDS.get(brand_key(make), make.strip().upper())

def load_logo(make: str | None) -> Image.Image | None:
    key = brand_key(make)
    if not key:
        return None
    # Official SVG sources are rasterized once by the asset script; runtime stays Pillow-only.
    try:
        with Image.open(LOGO_DIR / f'{key}.png') as image:
            return image.convert('RGBA')
    except (OSError, UnidentifiedImageError):
        return None
