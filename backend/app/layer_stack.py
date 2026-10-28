"""Strict mixed text/overlay document; no file, model or application imports."""
import re
from .text_layers import obj,number,color,boolean,choice,validate_text_layers
def fail():raise ValueError('Invalid layer stack.')
def validate_layer_stack(value):
    version=value.get('version') if isinstance(value,dict) else None
    obj(value,('version','frame','layers') if version==2 else ('version','layers'))
    if type(version) is not int or version not in (1,2) or type(value['layers']) is not list or len(value['layers'])>32:fail()
    if version==2:
        from .editor_schemas import CompositionV2,CropV2,check_composition
        f=value['frame'];obj(f,('source_width','source_height','crop','rotation','angle','flipX','flipY'));boolean(f['flipX']);boolean(f['flipY'])
        if type(f['rotation']) is not int or f['rotation'] not in (0,90,180,270):fail()
        check_composition(CropV2.model_validate(f['crop']),CompositionV2.model_validate({k:f[k] for k in ('source_width','source_height','angle')}),f['rotation'])
    layers=value['layers'];validate_text_layers(dict(version=1,layers=[{k:v for k,v in l.items() if version!=2 or k not in ('depth','scaleX','scaleY')} for l in layers if isinstance(l,dict) and l.get('kind')=='text']));seen=set()
    for layer in layers:
        if type(layer) is not dict or not isinstance(layer.get('id'),str) or layer['id'] in seen:fail()
        seen.add(layer['id'])
        if layer.get('kind') in ('text','sticker'):
            for k in ('scaleX','scaleY'):
                if k in layer:
                    if version!=2:fail()
                    number(layer[k],.01,32)
            if 'depth' in layer:
                if version!=2:fail()
                from .vision_schemas import DepthOcclusion
                DepthOcclusion.model_validate(layer['depth'])
        if layer.get('kind')=='text':continue
        if layer.get('kind')=='sticker':
            if version!=2:fail()
            keys=('id','kind','asset_hash','name','visible','locked','opacity','x','y','rotation','width','height','stroke','shadow','glow')+tuple(k for k in ('scaleX','scaleY','depth') if k in layer);obj(layer,keys)
            if re.fullmatch(r'sticker-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}',layer['id'],re.I) is None or not isinstance(layer['asset_hash'],str) or not re.fullmatch(r'[a-f0-9]{64}',layer['asset_hash']):fail()
            name=layer['name']
            if not isinstance(name,str) or not name.strip() or len(name)>120 or re.search(r'[\x00-\x1f\x7f]',name):fail()
            boolean(layer['visible']);boolean(layer['locked']);number(layer['opacity'],0,1);number(layer['x'],-4,5);number(layer['y'],-4,5);number(layer['rotation'],-180,180);number(layer['width'],.01,7680);number(layer['height'],.01,7680)
            stroke=layer['stroke'];obj(stroke,('enabled','color','width'));boolean(stroke['enabled']);color(stroke['color']);number(stroke['width'],0,100)
            for kind in ('shadow','glow'):
                p=layer[kind];obj(p,('enabled','color','opacity','x','y','blur') if kind=='shadow' else ('enabled','color','opacity','blur','passes'));boolean(p['enabled']);color(p['color']);number(p['opacity'],0,1);number(p['blur'],0,200)
                if kind=='shadow':number(p['x'],-1000,1000);number(p['y'],-1000,1000)
                elif type(p['passes']) is not int or not 1<=p['passes']<=4:fail()
            continue
        obj(layer,('id','kind','visible','locked','opacity','edge','coverage','paint'));choice(layer['kind'],('overlay',))
        if re.fullmatch(r'overlay-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}',layer['id'],re.I) is None:fail()
        boolean(layer['visible']);boolean(layer['locked']);number(layer['opacity'],0,1);number(layer['coverage'],.01,1);choice(layer['edge'],('top','bottom','left','right'));p=layer['paint']
        if isinstance(p,dict) and p.get('kind')=='solid':obj(p,('kind','color','opacity'));color(p['color']);number(p['opacity'],0,1)
        else:
            obj(p,('kind','angle','stops'));choice(p['kind'],('linear',));number(p['angle'],-360,360)
            if type(p['stops']) is not list or not 2<=len(p['stops'])<=16:fail()
            previous=-1
            for stop in p['stops']:
                obj(stop,('offset','color','opacity'));number(stop['offset'],0,1);color(stop['color']);number(stop['opacity'],0,1)
                if stop['offset']<previous:fail()
                previous=stop['offset']

def layer_asset_hashes(recipe):
    layers=recipe.get('layer_stack',{}).get('layers',[])
    return {value for layer in layers for value in ([layer['asset_hash']] if layer['kind']=='sticker' else [])+([layer['depth']['asset_hash']] if layer.get('depth') else [])}
