from PIL import Image, ImageFilter, ImageEnhance, ImageOps, ImageDraw
from .common import lines, rounded_paste, text_block

def render(image: Image.Image, photo: dict, options: dict) -> Image.Image:
    width, height = image.size
    unit = min(width, height)
    scale = options['photo_scale']
    border = round(unit * (1-scale) / 2)
    headings, params = lines(photo, options)
    size = max(10, round(unit * .024 * options['font_size']))
    footer = max(round(unit * .13), round(max(len(headings), 2) * size * 1.55)) if headings or params else border
    dimensions = (width + border*2, height + border*2 + footer)
    # Downsample first: blur derives entirely from the photograph's actual colors.
    blurred = ImageOps.fit(image, dimensions).resize((max(16, dimensions[0]//5), max(16, dimensions[1]//5)))
    blurred = blurred.filter(ImageFilter.GaussianBlur(max(1, unit * options['blur'] / 5)))
    blurred = ImageEnhance.Color(blurred).enhance(options['saturation'])
    blurred = ImageEnhance.Brightness(blurred).enhance(options['brightness'])
    blurred = blurred.resize(dimensions, Image.Resampling.BICUBIC)
    canvas = Image.blend(Image.new('RGB', dimensions, '#111315'), blurred.convert('RGB'), options['intensity'])
    radius = round(unit * options['radius'])
    if options['shadow']:
        shadow = Image.new('RGBA', dimensions)
        ImageDraw.Draw(shadow).rounded_rectangle((border, border+unit*.012, border+width, border+height+unit*.012), radius=radius, fill=(0,0,0,155))
        shadow = shadow.filter(ImageFilter.GaussianBlur(unit*.02))
        canvas = Image.alpha_composite(canvas.convert('RGBA'), shadow).convert('RGB')
    rounded_paste(canvas, image, (border, border), radius)
    if headings or params:
        padding = max(8, round(unit*.022))
        x, y = padding, height+border*2
        w, h = canvas.width-padding*2, footer-padding
        glass = Image.new('RGBA', canvas.size)
        draw = ImageDraw.Draw(glass)
        draw.rounded_rectangle((x,y,x+w,y+h), radius=max(8,h//2), fill=(18,24,28,145), outline=(255,255,255,155), width=max(1,round(unit*.002)))
        canvas = Image.alpha_composite(canvas.convert('RGBA'), glass).convert('RGB')
        if headings and params:
            split = round(w*.49)
            ImageDraw.Draw(canvas).line((x+split,y+h*.2,x+split,y+h*.8), fill='#9ba3a5', width=max(1,round(unit*.001)))
            text_block(canvas, headings, (x+padding,y,split-padding*2,h), '#f4f4ee', size, 'left')
            text_block(canvas, ['  '.join(params)], (x+split+padding,y,w-split-padding*2,h), '#f4f4ee', size)
        else:
            text_block(canvas, headings or ['  '.join(params)], (x+padding,y,w-padding*2,h), '#f4f4ee', size)
    return canvas
