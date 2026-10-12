"""Local signature artwork and bundled OFL fonts; previews and exports share these assets."""
from pathlib import Path
from math import ceil, floor
from PIL import Image, ImageDraw, ImageFont
from .common import font

ASSETS = Path(__file__).resolve().parents[1] / 'assets' / 'signatures'
FONTS = {'fine': 'Sacramento-Regular.ttf', 'brush': 'KaushanScript-Regular.ttf',
         'calligraphy': 'AlexBrush-Regular.ttf', 'chinese_brush': 'MaShanZheng-Regular.ttf',
         'chinese_running': 'ZhiMangXing-Regular.ttf', 'chinese_cursive': 'LiuJianMaoCao-Regular.ttf',
         'chinese_handwriting': 'LongCang-Regular.ttf'}

def signature_image(options: dict) -> Image.Image | None:
    style = options.get('signature_style', 'text')
    text = options.get('signature', '').strip()
    if 'signature' not in options.get('fields', []) or style == 'text' or not text:
        return None
    if style == 'natural':
        with Image.open(ASSETS / 'natural.png') as source:
            image = source.convert('RGBA')
    else:
        chinese = style.startswith('chinese_')
        typeface = font(160) if not chinese and any(ord(c) > 0x024F for c in text) else ImageFont.truetype(ASSETS / FONTS[style], 160)
        runs = [(text, typeface)]
        if chinese:
            # Keep the chosen calligraphy; only uncovered characters use the system font.
            missing = bytes(typeface.getmask('\U0010ffff'))
            uncovered = {c for c in set(text) if not c.isspace() and bytes(typeface.getmask(c)) == missing}
            if uncovered:
                fallback, runs = font(160), []
                for char in text:
                    face = fallback if char in uncovered else typeface
                    if runs and runs[-1][1] is face:runs[-1] = (runs[-1][0]+char, face)
                    else:runs.append((char, face))
        boxes, left = [], 0
        for run, face in runs:
            box = face.getbbox(run, anchor='ls')
            boxes.append((left+box[0], box[1], left+box[2], box[3]))
            left += face.getlength(run)
        box = (floor(min(b[0] for b in boxes)), min(b[1] for b in boxes), ceil(max(b[2] for b in boxes)), max(b[3] for b in boxes))
        image = Image.new('RGBA', (max(1, box[2]-box[0])+8, max(1, box[3]-box[1])+8))
        draw, left = ImageDraw.Draw(image), 4-box[0]
        for run, face in runs:
            draw.text((left, 4-box[1]), run, font=face, fill='black', anchor='ls')
            left += face.getlength(run)
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
