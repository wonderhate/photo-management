from pathlib import Path
from PIL import Image, ImageStat, ImageDraw
from .common import lines, rounded_paste, text_block, font
from .brand_logos import display_name, load_logo
from .signatures import signature_image, paste_signature

def classic_frame(image: Image.Image, photo: dict, options: dict) -> Image.Image:
    width, height = image.size
    unit = min(width, height)
    border = max(1, round(unit * options['border']))
    headings, params = lines(photo, options)
    texts = headings + (['  ·  '.join(params)] if params else [])
    signature = signature_image(options)
    signature_height = round(unit*.09) if signature is not None else 0
    size = max(10, int(unit * .023 * options['font_size']))
    info = max(int(unit * options['info_height']), int(len(texts) * size * 1.65) + border + signature_height) if texts or signature is not None else border
    theme = options['theme']
    if theme == 'auto':
        theme = 'black' if sum(ImageStat.Stat(image.resize((1,1))).mean) / 3 < 130 else 'white'
    background, foreground = ('#151719', '#f2f0e9') if theme == 'black' else ('#f7f5f0', '#25282b')
    canvas = Image.new('RGB', (width+border*2, height+border+info), background)
    rounded_paste(canvas, image, (border, border), int(unit * options['radius']))
    if signature is not None:
        text_block(canvas, headings, (border, height+border, width*.3, info), foreground, size, 'left')
        text_block(canvas, ['  ·  '.join(params)] if params else [], (border+width*.7, height+border, width*.3, info), foreground, size, 'right')
        paste_signature(canvas, signature, (border+width*.34, height+border+info*.15, width*.32, info*.7), foreground, 'center')
    elif texts:
        text_block(canvas, texts, (border, height+border, width, info-int(border*.25)), foreground, size, options['align'])
    return canvas

def info_lines(photo: dict, options: dict) -> tuple[list[str], list[str]]:
    fields = set(options['fields'])
    make = str(photo.get('camera_make') or '').strip() if 'camera_make' in fields else ''
    model = str(photo.get('camera_model') or '').strip() if 'camera_model' in fields else ''
    if make:
        left = [display_name(make), model]
    elif model:
        left = [model, str(photo.get('lens_model') or '') if 'lens_model' in fields else '']
    elif not photo.get('camera_make') and not photo.get('camera_model'):
        left = [Path(photo.get('file_name') or '').stem]
    else:
        left = []  # Explicitly unchecked camera fields stay hidden.
    if 'lens_model' in fields and photo.get('lens_model') and make:
        left.append(str(photo['lens_model']))
    params = []
    for key, format_value in [('focal_length', lambda v:f'{v:g}mm'), ('f_number', lambda v:f'F{v:g}'),
            ('exposure_time', lambda v:f'{v}s'), ('iso', lambda v:f'ISO{v:g}')]:
        value = photo.get(key)
        if key in fields and value is not None and value != '':
            params.append(format_value(value))
    right = ['  '.join(params)]
    if 'date_taken' in fields and photo.get('date_taken'):
        right.append(str(photo['date_taken']).replace('T', ' ')[:19])
    return [text for text in left if text], right

def info_block(draw: ImageDraw.ImageDraw, texts: list[str], rect: tuple[float,float,float,float],
               size: float, secondary_scale: float, align: str) -> None:
    rows = [(i,text) for i,text in enumerate(texts) if text]
    if not rows:
        return
    x, y, width, height = rect
    size = max(8, round(size))
    while True:
        fonts = [font(size if i == 0 else round(size * secondary_scale), bold=i == 0) for i,text in rows]
        boxes = [draw.textbbox((0,0), text, font=f) for (i,text),f in zip(rows, fonts)]
        gap = max(2, round(size * .4))
        total = sum(box[3]-box[1] for box in boxes) + gap * (len(rows)-1)
        if size <= 8 or (total <= height and all(draw.textlength(t,font=f) <= width for (i,t),f in zip(rows, fonts))):
            break
        size -= 1
    top = y + max(0, (height-total)/2)
    for (i,text), f, box in zip(rows, fonts, boxes):
        # Keep extraordinarily long metadata inside its own column.
        while text and draw.textlength(text, font=f) > width:
            text = text[:-1]
        left = x + width - draw.textlength(text, font=f) if align == 'right' else x
        draw.text((left, top-box[1]), text, font=f, fill='#111111' if i==0 else '#8A8A8A')
        top += box[3]-box[1]+gap

def render(image: Image.Image, photo: dict, options: dict) -> Image.Image:
    if options.get('style') == 'classic_frame':
        return classic_frame(image, photo, options)
    width, height = image.size
    ratio = options.get('info_bar_ratio', .14)
    bar = max(1, round(height * ratio / (1-ratio)))
    canvas = Image.new('RGB', (width, height+bar), '#FFFFFF')
    canvas.paste(image, (0,0))
    draw = ImageDraw.Draw(canvas)
    pad = width * .04
    left, right = info_lines(photo, options)
    size = width * .022 * options.get('font_scale', 1)
    signature = signature_image(options)
    logo = load_logo(photo.get('camera_make')) if options.get('show_brand_logo', True) else None
    logo_center, divider = (width*.65, width*.71) if signature is not None else (width*.58, width*.64)
    if logo:
        box = max(1, round(min(bar*.46, width*.085)))
        logo.thumbnail((box,box), Image.Resampling.LANCZOS)
    if signature is not None:
        info_block(draw, left, (pad, height+bar*.18, width*.36-pad*1.5, bar*.64), size, .45, 'left')
        signature_width = min(width*.28, 2*(logo_center-logo.width/2-pad*.3-width/2)) if logo else width*.28
        paste_signature(canvas, signature, ((width-signature_width)/2, height+bar*.18, signature_width, bar*.64), '#111111', 'center')
    else:
        info_block(draw, left, (pad, height+bar*.18, width*.52-pad*1.5, bar*.64), size, .45, 'left')
    info_block(draw, right, (divider+pad*.5, height+bar*.18, width-divider-pad*1.5, bar*.64), size*.72, .62, 'right')
    if logo:
        canvas.paste(logo, (round(logo_center-logo.width/2), round(height+(bar-logo.height)/2)), logo)
    # A single quiet divider, matching the reference's separation before the EXIF block.
    draw.line((round(divider),height+bar*.25,round(divider),height+bar*.75), fill='#E6E6E6', width=max(1,round(width/1920)))
    return canvas
