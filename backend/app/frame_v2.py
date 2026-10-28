"""Strict frame-v2 snapshots. Geometry mirrors frontend/src/core/frame-v2.ts.

Anchor geometry adapted from AfterFrame (MIT), commit
26e19935469e696133088b798f23b5b3654d910f; license retained in public/licenses.
"""
import base64
import hashlib
import math
import re
from io import BytesIO


def fail(): raise ValueError('Invalid v2 frame document.')
def obj(v, keys):
    if type(v) is not dict or not set(v).issubset(keys): fail()
def number(v, low, high): return type(v) in (float,int) and math.isfinite(v) and low<=v<=high
def text(v, limit): return isinstance(v,str) and not re.search(r'[\x00-\x08\x0b-\x1f\x7f\ud800-\udfff]',v) and len(v.encode('utf-16-le'))//2<=limit
def identifier(v): return isinstance(v,str) and re.fullmatch(r'[a-zA-Z0-9-]{1,80}',v)
def color(v): return isinstance(v,str) and re.fullmatch(r'#[a-fA-F0-9]{6}',v)
def choice(v, values): return isinstance(v,str) and v in values


def anchor(v):
    obj(v,('region','h','v','inset','dx','dy'))
    if not choice(v.get('region'),('top','bottom','left','right','full')) or not choice(v.get('h'),('left','center','right')) or not (choice(v.get('v'),('top','center','bottom')) or number(v.get('v'),0,1)):fail()
    for key,low,high in [('inset',0,.5),('dx',-1,1),('dy',-1,1)]:
        if key in v and not number(v[key],low,high):fail()


def validate_template(v):
    obj(v,('id','name','family','canvas','elements'))
    if not identifier(v.get('id')) or not text(v.get('name'),120) or not v['name'].strip() or not text(v.get('family'),40):fail()
    c=v.get('canvas');obj(c,('pad','bg','scrim'));obj(c.get('pad'),('top','right','bottom','left'));obj(c.get('bg'),('type','color'))
    if any(not number(n,0,.5) for n in c['pad'].values()) or c['bg'].get('type')!='solid' or not color(c['bg'].get('color')):fail()
    if 'scrim' in c:
        s=c['scrim'];obj(s,('edge','from','to','height'))
        if 'edge' in s and not choice(s['edge'],('top','bottom')) or not number(s.get('height'),.01,1):fail()
        for key in ('from','to'):
            value=s.get(key)
            if not isinstance(value,str) or not re.fullmatch(r'rgba\(0,0,0,(?:0|1|0?\.\d{1,3})\)',value) or float(value[11:-1])>1:fail()
    elements=v.get('elements')
    if type(elements) is not list or len(elements)>32:fail()
    for e in elements:
        obj(e,('type','anchor','style','content','fields','group','labeled','variant','strict','color','soloAnchor'))
        if not choice(e.get('type'),('text','exif','logo')):fail()
        anchor(e.get('anchor'))
        if 'soloAnchor' in e:
            obj(e['soloAnchor'],('region','h','v','inset','dx','dy'));anchor({**e['anchor'],**e['soloAnchor']})
        s=e.get('style');obj(s,('font','weight','size','color','opacity','rotation','tracking'))
        if not number(s.get('size'),.004,.3):fail()
        if 'font' in s and not choice(s['font'],('grotesk','serif','mono','hand')) or 'color' in s and not color(s['color']):fail()
        for key,low,high in [('weight',100,900),('opacity',0,100),('rotation',-180,180),('tracking',-.1,1)]:
            if key in s and (not number(s[key],low,high) or key=='weight' and s[key]!=int(s[key])):fail()
        if e['type']=='text' and not text(e.get('content'),1000) or 'content' in e and not text(e['content'],1000):fail()
        if 'group' in e and not text(e['group'],40) or 'color' in e and not color(e['color']) or 'variant' in e and not choice(e['variant'],('symbol','wordmark')):fail()
        if any(key in e and type(e[key]) is not bool for key in ('strict','labeled')):fail()
        if e['type']=='exif' or 'fields' in e:
            fields=e.get('fields')
            if type(fields) is not list or len(fields)>8 or any(not choice(f,('focal','aperture','shutter','iso')) for f in fields):fail()
    return v


def validate_logo(v):
    try:
        obj(v,('id','name','make','variant','source','license','data_url','width','height','sha256'))
        if not identifier(v.get('id')) or not text(v.get('name'),120) or not v['name'].strip() or not text(v.get('make'),200) or not choice(v.get('variant'),('symbol','wordmark','both')):fail()
        if any(not text(v.get(key),500) or not v[key].strip() for key in ('source','license')):fail()
        data=v.get('data_url')
        if not isinstance(data,str) or len(data)>3_000_000 or not re.fullmatch(r'data:image/png;base64,[A-Za-z0-9+/]+={0,2}',data):fail()
        if any(not number(v.get(key),1,2048) or v[key]!=int(v[key]) for key in ('width','height')):fail()
        if not isinstance(v.get('sha256'),str) or not re.fullmatch(r'[a-f0-9]{64}',v['sha256']):fail()
    except (ValueError,TypeError,KeyError,UnicodeError) as error:
        raise ValueError('Invalid logo asset.') from error
    return v


def logo_image(v):
    from PIL import Image
    validate_logo(v)
    try:
        data=base64.b64decode(v['data_url'].split(',',1)[1],validate=True)
        if hashlib.sha256(data).hexdigest()!=v['sha256']:raise ValueError()
        with Image.open(BytesIO(data)) as source:
            if source.format!='PNG' or source.size!=(v['width'],v['height']):raise ValueError()
            source.load();return source.convert('RGBA')
    except Exception as error:raise ValueError('Invalid logo asset.') from error


def validate_frame(v):
    obj(v,('version','template','margin','text_scale','tokens','logo','logo_mode','logo_tone'))
    if type(v.get('version')) is not int or v['version']!=2 or not number(v.get('margin'),.1,3) or not number(v.get('text_scale'),.5,2):fail()
    tokens=v.get('tokens')
    if type(tokens) is not dict or len(tokens)>32 or any(not re.fullmatch(r'[a-z][a-z0-9_]{0,31}',key) or not text(value,500) for key,value in tokens.items()) or not choice(v.get('logo_mode'),('auto','manual','none')) or not choice(v.get('logo_tone'),('auto','original','black','white','gold')):fail()
    validate_template(v.get('template'))
    if 'logo' not in v:fail()
    if v['logo'] is not None:validate_logo(v['logo'])
    if v['logo_mode']=='none' and v['logo'] is not None or v['logo_mode']=='manual' and v['logo'] is None:fail()
    return v


def validate_user_frame(v):
    obj(v,('version','id','name','template','margin','text_scale'))
    if type(v.get('version')) is not int or v['version']!=2 or not identifier(v.get('id')) or not text(v.get('name'),120) or not v['name'].strip() or not number(v.get('margin'),.1,3) or not number(v.get('text_scale'),.5,2):fail()
    validate_template(v.get('template'));return v


def frame_text(e,tokens):
    if e['type']=='logo':return ''
    if e['type']=='text':return re.sub(r'\{([a-z][a-z0-9_]*)\}',lambda m:tokens.get(m[1],''),e.get('content',''))
    labels={'focal':'Focal','aperture':'Aperture','shutter':'Shutter','iso':'ISO'}
    parts=[f"{labels[k]} | {tokens[k].removeprefix('ISO ')}" if e.get('labeled') else tokens[k] for k in e.get('fields',[]) if tokens.get(k)]
    return ('       ' if e.get('labeled') else '   |   ').join(parts)


def geometry(width,height,doc,edge=0):
    validate_frame(doc)
    if not number(width,1,100000) or not number(height,1,100000) or width!=int(width) or height!=int(height) or width*height>100_000_000 or not number(edge,0,16000) or edge!=int(edge):fail()
    unit=min(width,height)*1.5;pad={k:doc['template']['canvas']['pad'].get(k,0)*unit*doc['margin'] for k in ('top','right','bottom','left')}
    full_width=math.floor(width+pad['left']+pad['right']+.5);full_height=math.floor(height+pad['top']+pad['bottom']+.5)
    scale=min(1,edge/max(full_width,full_height)) if edge else 1
    out_width=max(1,math.floor(full_width*scale+.5));out_height=max(1,math.floor(full_height*scale+.5))
    if max(out_width,out_height)>16000 or out_width*out_height>64_000_000:raise ValueError('Frame export exceeds 16000 pixels or 64 megapixels. Select an explicit output edge.')
    return dict(unit=unit,pad=pad,fullWidth=full_width,fullHeight=full_height,scale=scale,width=out_width,height=out_height)


def layers(width,height,doc,edge=0):
    g=geometry(width,height,doc,edge);elements=doc['template']['elements'];groups={};offsets={}
    for i,e in enumerate(elements):
        if e.get('group') and e['type']!='logo' and frame_text(e,doc['tokens']):groups.setdefault(e['group'],[]).append(i)
    for members in groups.values():
        heights=[elements[i]['style']['size']*doc['text_scale']*1.6 for i in members];y=-sum(heights)/2
        for i,h in zip(members,heights):offsets[i]=y+h/2;y+=h
    logo=doc['logo'];logos=[e for e in elements if e['type']=='logo' and logo and (not e.get('strict') or logo['variant']=='both' or logo['variant']==e.get('variant'))]
    result=[]
    for i,e in enumerate(elements):
        if e['type']=='logo' and (not logo or e.get('strict') and logo['variant']!='both' and logo['variant']!=e.get('variant')):continue
        content=frame_text(e,doc['tokens'])
        if e['type']!='logo' and not content:continue
        a={**e['anchor'],**(e.get('soloAnchor',{}) if len(logos)==1 and e['type']=='logo' else {})};u=g['unit']*doc['margin'];inset=a.get('inset',.05)*u;dx=a.get('dx',0)*u;dy=(a.get('dy',0)+offsets.get(i,0))*u;align=a['h'];v=a['v']
        if a['region'] in ('left','right'):
            left=0 if a['region']=='left' else g['fullWidth']-g['pad']['right'];w=g['pad'][a['region']]
            x=left+w*({'left':.3,'right':.7}.get(a['h'],.5))+dx;y=g['fullHeight']*(v if type(v) in (int,float) else {'top':.12,'bottom':.88}.get(v,.5))+dy;align='center'
        else:
            top=g['fullHeight']-g['pad']['bottom'] if a['region']=='bottom' else 0
            h=g['pad']['top'] if a['region']=='top' else g['pad']['bottom'] if a['region']=='bottom' else g['fullHeight']
            x=(inset if a['h']=='left' else g['fullWidth']-inset if a['h']=='right' else g['fullWidth']/2)+dx;y=top+h*(v if type(v) in (int,float) else {'top':.32,'bottom':.68}.get(v,.5))+dy
        result.append(dict(element=e,text=content,x=x,y=y,align=align,size=e['style']['size']*g['unit']*(1 if e['type']=='logo' else doc['text_scale'])))
    return {**g,'layers':result}
