"""Local signature artwork and bundled OFL fonts; previews and exports share these assets."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from .common import font

ASSETS = Path(__file__).resolve().parents[1] / 'assets' / 'signatures'
FONTS = {'fine': 'Sacramento-Regular.ttf', 'brush': 'KaushanScript-Regular.ttf',
         'calligraphy': 'AlexBrush-Regular.ttf'}

def signature_image(options: dict) -> Image.Image | None:
    style = options.get('signature_style', 'text')
    text = options.get('signature', '').strip()
    if 'signature' not in options.get('fields', []) or style == 'text' or not text:
        return None
    if style == 'natural':
        with Image.open(ASSETS / 'natural.png') as source:
            image = source.convert('RGBA')
    else:
        # These handwriting fonts cover Latin; use the existing typeface for other scripts.
        typeface = font(160) if any(ord(c) > 0x024F for c in text) else ImageFont.truetype(ASSETS / FONTS[style], 160)
        box = typeface.getbbox(text)
        image = Image.new('RGBA', (max(1, box[2]-box[0])+8, max(1, box[3]-box[1])+8))
        ImageDraw.Draw(image).text((4-box[0], 4-box[1]), text, font=typeface, fill='black')
    bounds = image.getchannel('A').getbbox()
    return image.crop(bounds) if bounds else None

def paste_signature(canvas: Image.Image, signature: Image.Image | None,
                    rect: tuple[float,float,float,float], color: str, align: str = 'left') -> None:
    if signature is None:
        return
    x, y, width, height = rect
    signature = signature.copy()
    signature.thumbnail((max(1,round(width)), max(1,round(height))), Image.Resampling.LANCZOS)
    mask = signature.getchannel('A')
    ink = Image.new('RGB', signature.size, color)
    left = x + (width-signature.width)/2 if align == 'center' else x+width-signature.width if align == 'right' else x
    canvas.paste(ink, (round(left), round(y+(height-signature.height)/2)), mask)
