from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

def font(size: int, bold: bool = False):
    choices = ['C:/Windows/Fonts/msyhbd.ttc' if bold else 'C:/Windows/Fonts/msyh.ttc',
               'C:/Windows/Fonts/arialbd.ttf' if bold else 'C:/Windows/Fonts/arial.ttf',
               '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']
    for value in choices:
        if Path(value).exists():
            return ImageFont.truetype(value, max(8, size))
    return ImageFont.load_default(size=max(8, size))

def lines(photo: dict, options: dict) -> tuple[list[str], list[str]]:
    fields = set(options.get('fields', []))
    heading, params = [], []
    make = photo.get('camera_make') if 'camera_make' in fields else None
    model = photo.get('camera_model') if 'camera_model' in fields else None
    camera = ' '.join(str(v) for v in [make, model] if v)
    if make and model and model.casefold().startswith(make.casefold()):
        camera = model
    if camera: heading.append(camera)
    if 'lens_model' in fields and photo.get('lens_model'): heading.append(str(photo['lens_model']))
    for name, render in [('focal_length', lambda v: f'{v:g}mm'), ('f_number', lambda v: f'f/{v:g}'),
                         ('exposure_time', lambda v: f'{v}s'), ('iso', lambda v: f'ISO {v}')]:
        if name in fields and photo.get(name) is not None:
            params.append(render(photo[name]))
    if 'date_taken' in fields and photo.get('date_taken'):
        heading.append(str(photo['date_taken']).replace('T', ' ')[:19])
    if 'signature' in fields and options.get('signature', '').strip():
        heading.append(options['signature'].strip())
    return heading, params

def rounded_paste(canvas: Image.Image, image: Image.Image, xy: tuple[int, int], radius: int) -> None:
    mask = Image.new('L', image.size)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, image.width-1, image.height-1), radius=radius, fill=255)
    canvas.paste(image, xy, mask)

def wrap_text(text: str, draw: ImageDraw.ImageDraw, typeface, max_width: int) -> list[str]:
    lines_out, current = [], ''
    for char in text:
        if current and draw.textlength(current + char, font=typeface) > max_width:
            lines_out.append(current)
            current = char
        else:
            current += char
    if current: lines_out.append(current)
    return lines_out

def text_block(canvas: Image.Image, texts: list[str], rect: tuple[int,int,int,int], color: str, size: int, align: str = 'center') -> None:
    if not texts:
        return
    draw = ImageDraw.Draw(canvas)
    x, y, width, height = rect
    size = max(8, size)
    while True:
        typeface = font(size)
        wrapped = [line for text in texts for line in wrap_text(text, draw, typeface, width)]
        line_height = int(size * 1.5)
        if line_height * len(wrapped) <= height or size <= 8:
            break
        size -= 1
    top = y + max(0, (height-len(wrapped)*line_height)//2)
    for line in wrapped:
        measured = draw.textlength(line, font=typeface)
        left = x if align == 'left' else x + width - measured if align == 'right' else x + (width-measured)/2
        draw.text((left, top), line, fill=color, font=typeface)
        top += line_height
