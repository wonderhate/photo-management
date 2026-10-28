"""Pure text-document contract, shared by HTTP and offline library validation."""
import math
import re

FONTS={'sans','serif','mono','fine','brush','calligraphy','chinese_brush','chinese_running','chinese_cursive','chinese_handwriting'}
KEYS=set('id kind text visible locked x y rotation font size weight italic underline strikethrough letterSpacing lineHeight textCase align opacity fill stroke background shadow glow'.split())


def fail():raise ValueError('Invalid text layers.')
def obj(value,keys):
    if type(value) is not dict or set(value)!=set(keys):fail()
def number(value,low,high,integer=False):
    if type(value) not in (int,float) or not low<=value<=high or not math.isfinite(value) or integer and value!=int(value):fail()
def boolean(value):
    if type(value) is not bool:fail()
def color(value):
    if not isinstance(value,str) or re.fullmatch(r'#[a-fA-F0-9]{6}',value) is None:fail()
def choice(value,values):
    if not isinstance(value,str) or value not in values:fail()
def paint(value):
    if isinstance(value,dict) and value.get('kind')=='solid':
        obj(value,('kind','color','opacity'));color(value['color']);number(value['opacity'],0,1)
    else:
        obj(value,('kind','from','to','fromOpacity','toOpacity','angle'));choice(value['kind'],('linear',))
        color(value['from']);color(value['to']);number(value['fromOpacity'],0,1);number(value['toOpacity'],0,1);number(value['angle'],-360,360)


def validate_text_layers(value):
    obj(value,('version','layers'))
    if type(value['version']) is not int or value['version']!=1 or type(value['layers']) is not list or len(value['layers'])>32:fail()
    seen=set();total=0
    for v in value['layers']:
        obj(v,KEYS)
        if not isinstance(v['id'],str) or not re.fullmatch(r'text-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}',v['id'],re.I) or v['id'] in seen:fail()
        seen.add(v['id']);choice(v['kind'],('text',))
        text=v['text']
        if not isinstance(text,str) or re.search(r'[\x00-\x09\x0b-\x1f\x7f-\x9f\ud800-\udfff]',text) or len(text.split('\n'))>128:fail()
        length=len(text.encode('utf-16-le'))//2
        if length>8192:fail()
        total+=length
        for key in ('visible','locked','italic','underline','strikethrough'):boolean(v[key])
        for key,low,high in [('x',-4,5),('y',-4,5),('rotation',-180,180),('size',1,1000),('letterSpacing',-.1,2),('lineHeight',.5,5),('opacity',0,1)]:number(v[key],low,high)
        number(v['weight'],100,900,True);choice(v['font'],FONTS);choice(v['textCase'],('none','upper','lower','title'));choice(v['align'],('left','center','right'));paint(v['fill'])
        stroke=v['stroke'];obj(stroke,('enabled','width','paint'));boolean(stroke['enabled']);number(stroke['width'],0,100);paint(stroke['paint'])
        bg=v['background'];obj(bg,('enabled','paint','padding'));boolean(bg['enabled']);paint(bg['paint'])
        if type(bg['padding']) is not list or len(bg['padding'])!=4:fail()
        for n in bg['padding']:number(n,0,1000)
        shadow=v['shadow'];obj(shadow,('enabled','color','opacity','x','y','blur'));boolean(shadow['enabled']);color(shadow['color']);number(shadow['opacity'],0,1);number(shadow['x'],-1000,1000);number(shadow['y'],-1000,1000);number(shadow['blur'],0,200)
        glow=v['glow'];obj(glow,('enabled','color','opacity','blur','passes'));boolean(glow['enabled']);color(glow['color']);number(glow['opacity'],0,1);number(glow['blur'],0,200);number(glow['passes'],1,4,True)
    if total>32768:fail()
