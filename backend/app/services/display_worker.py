"""Isolated, read-only full-size TIFF/HEIF display decoder (no RAW thumbnail)."""
import json
from pathlib import Path


def render(source: str, target: str, edge: int):
    target = Path(target)
    try:
        from PIL import Image
        from .image_decode import display_image, srgb_profile
        with display_image(source) as image:
            image.thumbnail((edge, edge), Image.Resampling.LANCZOS)
            image.save(target, 'JPEG', quality=94, icc_profile=srgb_profile())
            target.with_suffix('.json').write_text(json.dumps({'width': image.width, 'height': image.height}), 'utf-8')
    except Exception:
        # Never forward native decoder errors, original paths or metadata to the UI.
        target.with_suffix('.json').write_text('{"error":true}', 'utf-8')
