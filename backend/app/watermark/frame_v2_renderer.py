"""Frame v2: a shared pixel plan for preview and export, separate from v1."""
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageColor
from ..frame_v2 import layers, logo_image
from ..services.image_decode import display_image, srgb_profile
from ..config import RAW_EXTENSIONS
from .common import font as system_font
from .signatures import ASSETS, FONTS


def source_image(path):
    path=Path(path)
    if path.stat().st_size>256*1024**2:raise ValueError('Frame source exceeds the 256 MiB processing limit.')
    if path.suffix.lower() not in RAW_EXTENSIONS:return display_image(path)
    import rawpy
    with rawpy.imread(str(path)) as raw:
        if max(raw.sizes.raw_width*raw.sizes.raw_height,raw.sizes.width*raw.sizes.height)>100_000_000:raise ValueError('Image exceeds the 100 megapixel limit.')
        # Framing is an output operation: never substitute an embedded RAW preview.
        pixels=raw.postprocess(use_camera_wb=True,half_size=False,no_auto_bright=True,output_bps=8,output_color=rawpy.ColorSpace.sRGB)
    return Image.fromarray(pixels)


def typeface(style,size):
    size=max(1,round(size));kind=style.get('font','grotesk')
    if kind=='hand':return ImageFont.truetype(ASSETS/FONTS['fine'],size)
    choices={'serif':['C:/Windows/Fonts/simsun.ttc','C:/Windows/Fonts/georgia.ttf','/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf'],
             'mono':['C:/Windows/Fonts/consola.ttf','/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf']}.get(kind,[])
    for path in choices:
        if Path(path).is_file():return ImageFont.truetype(path,size)
    fallback=system_font(12,style.get('weight',400)>=600)
    return ImageFont.truetype(fallback.path,size) if hasattr(fallback,'path') else ImageFont.load_default(size=size)


def text_image(text,style,size,max_width,scale):
    # Fit in full-source coordinates, independent of the requested output edge.
    face=typeface(style,size);tracking=style.get('tracking',0)*size
    width=face.getlength(text)+max(0,len(text)-1)*tracking
    fit=min(1,max_width/max(1,width));actual=max(1,size*fit*scale)
    face=typeface(style,actual);tracking=style.get('tracking',0)*actual
    positions=[];x=0;top=0;bottom=1;left=0;right=1
    for char in text:
        box=face.getbbox(char,anchor='ls');positions.append(x);left=min(left,x+box[0]);right=max(right,x+box[2]);top=min(top,box[1]);bottom=max(bottom,box[3]);x+=face.getlength(char)+tracking
    result=Image.new('RGBA',(max(1,math.ceil(right-left)+4),max(1,math.ceil(bottom-top)+4)))
    draw=ImageDraw.Draw(result);ink=ImageColor.getrgb(style.get('color','#1a1a1a'))+(round(style.get('opacity',100)*2.55),)
    for char,x in zip(text,positions):draw.text((x-left+2,2-top),char,font=face,fill=ink,anchor='ls')
    return result


def render(image,doc,edge=0):
    plan=layers(image.width,image.height,doc,edge);scale=plan['scale'];pad=plan['pad'];template=doc['template']
    canvas=Image.new('RGB',(plan['width'],plan['height']),template['canvas']['bg']['color'])
    photo=image.resize((max(1,round(image.width*scale)),max(1,round(image.height*scale))),Image.Resampling.LANCZOS)
    canvas.paste(photo,(round(pad['left']*scale),round(pad['top']*scale)));photo.close()
    scrim=template['canvas'].get('scrim')
    if scrim:
        import numpy as np
        h=max(1,round(canvas.height*scrim['height']));start=float(scrim['from'][11:-1]);end=float(scrim['to'][11:-1])
        alpha=np.linspace(start,end,h)
        if scrim.get('edge')=='top':alpha=alpha[::-1]
        pixels=np.zeros((h,canvas.width,4),dtype=np.uint8);pixels[:,:,3]=np.rint(alpha[:,None]*255).astype(np.uint8)
        overlay=Image.fromarray(pixels);canvas.paste(overlay,(0,0 if scrim.get('edge')=='top' else canvas.height-h),overlay);overlay.close()
    logo=logo_image(doc['logo']) if doc['logo'] else None
    try:
        for layer in plan['layers']:
            element=layer['element'];style=element['style'];x=layer['x']*scale;y=layer['y']*scale;rotation=style.get('rotation',0)
            if element['type']=='logo':
                if logo is None:continue
                h=max(1,round(layer['size']*scale));w=max(1,round(h*logo.width/logo.height));max_width=max(1,round(canvas.width*.8))
                if w>max_width:h=max(1,round(h*max_width/w));w=max_width
                # Premultiplied resize avoids a colored fringe around translucent edges.
                picture=logo.convert('RGBa').resize((w,h),Image.Resampling.LANCZOS).convert('RGBA')
                tone=doc['logo_tone'];color={'black':'#000000','white':'#ffffff','gold':'#b08d4c'}.get(tone)
                if tone=='auto':color=element.get('color')
                alpha=picture.getchannel('A')
                if style.get('opacity',100)!=100:alpha=alpha.point(lambda a:round(a*style['opacity']/100))
                if color:
                    picture.close();picture=Image.new('RGBA',(w,h),color)
                picture.putalpha(alpha);alpha.close()
            else:
                if abs(rotation)%180==90:available=plan['fullHeight']*.8
                elif layer['align']=='left':available=plan['fullWidth']-layer['x']-plan['unit']*.03
                elif layer['align']=='right':available=layer['x']-plan['unit']*.03
                else:available=2*min(layer['x'],plan['fullWidth']-layer['x'])-plan['unit']*.06
                picture=text_image(layer['text'],style,layer['size'],max(1,available),scale)
            try:
                if rotation:
                    turned=picture.rotate(-rotation,Image.Resampling.BICUBIC,expand=True);picture.close();picture=turned
                px=x if layer['align']=='left' else x-picture.width if layer['align']=='right' else x-picture.width/2
                canvas.paste(picture,(round(px),round(y-picture.height/2)),picture)
            finally:picture.close()
        canvas.info.clear();canvas.info['icc_profile']=srgb_profile();return canvas
    except Exception:
        canvas.close();raise
    finally:
        if logo is not None:logo.close()
