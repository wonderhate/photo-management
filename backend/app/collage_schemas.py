"""Strict portable collage contracts shared with the local renderer."""
import json
import math
import re
from datetime import datetime
from pathlib import Path
from .source_decode import SourceDecodeProfile

TEMPLATES={t['id']:t['cells'] for t in json.loads((Path(__file__).parent/'assets/collage-templates.json').read_text('utf-8'))}
UUID=re.compile(r'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$')
IDENTIFIER=re.compile(r'^[a-zA-Z0-9-]{1,80}$')
HASH=re.compile(r'^[a-f0-9]{64}$')

def fail():raise ValueError('Invalid collage project.')
def matches(pattern,value):return isinstance(value,str) and pattern.fullmatch(value) is not None
def exact(value,required,optional=()):
    if not isinstance(value,dict) or not set(required)<=set(value)<=set(required)|set(optional):fail()
def number(value,low,high,integer=False):
    if type(value) not in (int,float) or not math.isfinite(value) or not low<=value<=high or integer and int(value)!=value:fail()

def source(value):
    exact(value,('id','name','sha256','width','height','bits','profile'),('photo_id',))
    if not matches(IDENTIFIER,value['id']) or not matches(HASH,value['sha256']) or not isinstance(value['name'],str) or not 1<=len(value['name'])<=255 or re.search(r'[\\/\x00-\x1f]',value['name']):fail()
    number(value['width'],1,100000,True);number(value['height'],1,100000,True)
    if value['width']*value['height']>100_000_000 or type(value['bits']) is not int or value['bits'] not in (8,16):fail()
    SourceDecodeProfile.model_validate(value['profile'])
    if 'photo_id' in value and not matches(IDENTIFIER,value['photo_id']):fail()

def cell(value,ids):
    exact(value,('source_id','pan','zoom'));exact(value['pan'],('x','y'))
    if value['source_id'] not in ids:fail()
    number(value['pan']['x'],-2,2);number(value['pan']['y'],-2,2);number(value['zoom'],.25,5)

def scene(value):
    exact(value,('version','template','width','height','gap','padding','radius','background','sources','cells'),('edge_blend',))
    if type(value['version']) is not int or value['version'] not in (1,2):fail()
    if value['version']==1 and 'edge_blend' in value:fail()
    if value['version']==2:number(value.get('edge_blend'),0,10000)
    number(value['width'],100,12000,True);number(value['height'],100,12000,True)
    number(value['gap'],0,.08);number(value['padding'],0,.2);number(value['radius'],0,.2)
    if value['width']*value['height']>100_000_000 or not isinstance(value['background'],str) or not re.fullmatch(r'#[a-fA-F0-9]{6}',value['background']):fail()
    template=TEMPLATES.get(value['template'])
    if not template or not isinstance(value['sources'],list) or not 1<=len(value['sources'])<=12 or not isinstance(value['cells'],list) or len(value['cells'])!=len(template):fail()
    for item in value['sources']:source(item)
    ids=[s['id'] for s in value['sources']]
    if len(set(ids))!=len(ids):fail()
    for item in value['cells']:cell(item,ids)
    if sorted(c['source_id'] for c in value['cells'])!=sorted(ids):fail()
    base=min(value['width'],value['height']);pad=value['padding']*base;gap=value['gap']*base;w=value['width']-2*pad;h=value['height']-2*pad
    rnd=lambda x:math.floor(x+.5)
    for c in template:
        left=rnd(pad+c['x']*w+(gap/2 if c['x']>1e-8 else 0));right=rnd(pad+(c['x']+c['w'])*w-(gap/2 if c['x']+c['w']<1-1e-8 else 0))
        top=rnd(pad+c['y']*h+(gap/2 if c['y']>1e-8 else 0));bottom=rnd(pad+(c['y']+c['h'])*h-(gap/2 if c['y']+c['h']<1-1e-8 else 0))
        if right<=left or bottom<=top:fail()

def book(value):
    exact(value,('version','size','order','remainder','items','sequence','pages','omitted','placements'))
    if type(value['version']) is not int or value['version'] not in (1,2) or type(value['size']) is not int or value['size'] not in (2,3,4,6,9) or value['order'] not in ('selection','filename','capture_time') or value['remainder'] not in ('own','merge','drop'):fail()
    if any(not isinstance(value[k],list) for k in ('items','sequence','pages','omitted','placements')) or not 1<=len(value['items'])<=240:fail()
    items={}
    for item in value['items']:
        exact(item,('source','capture_time'));source(item['source']);key=item['source']['id']
        if key in items:fail()
        items[key]=item;date=item['capture_time']
        if date is not None:
            if not isinstance(date,str) or not re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d',date):fail()
            datetime.fromisoformat(date)
    if len(value['sequence'])!=len(items) or set(value['sequence'])!=set(items):fail()
    ordered=[items[key] for key in value['sequence']];name=lambda i:i['source']['name'].lower().encode('utf-16-be','surrogatepass')
    if value['order']=='filename':ordered.sort(key=name)
    elif value['order']=='capture_time':ordered.sort(key=lambda i:(0,i['capture_time']) if i['capture_time'] else (1,name(i)))
    size=value['size'];groups=[ordered[i:i+size] for i in range(0,len(ordered),size)];omitted=[]
    if groups and len(groups[-1])<size:
        if value['remainder']=='drop':omitted=groups.pop()
        elif value['remainder']=='merge' and len(groups)>1 and len(groups[-2])+len(groups[-1])<=12:groups[-2].extend(groups.pop())
    if len(value['pages'])!=len(groups) or value['omitted']!=[i['source']['id'] for i in omitted]:fail()
    active={}
    for page,group in zip(value['pages'],groups):
        scene(page)
        if value['version']==1 and page['version']!=1 or [c['source_id'] for c in page['cells']]!=[i['source']['id'] for i in group] or any(s!=items[s['id']]['source'] for s in page['sources']):fail()
        active.update({c['source_id']:c for c in page['cells']})
    if len(value['placements'])!=len(items):fail()
    placed=set()
    for placement in value['placements']:
        cell(placement,items);key=placement['source_id']
        if key in placed or key in active and placement!=active[key]:fail()
        placed.add(key)

def document(value):
    exact(value,('kind','value'))
    if value['kind']=='single':scene(value['value'])
    elif value['kind']=='batch':book(value['value'])
    else:fail()
    return value

def sources(value):return value['value']['sources'] if value['kind']=='single' else [i['source'] for i in value['value']['items']]

def save(value):
    exact(value,('id','request_id','expected_revision','name','document'))
    if not matches(UUID,value['id']) or not matches(UUID,value['request_id']) or not isinstance(value['name'],str) or not value['name'].strip() or len(value['name'])>120 or re.search(r'[\x00-\x1f]',value['name']):fail()
    number(value['expected_revision'],0,2**53-1,True);document(value['document']);return value

def record(value):
    exact(value,('version','id','name','revision','request_id','created_at','updated_at','document','origin_library_id','photo_links'))
    if type(value['version']) is not int or value['version']!=1 or not matches(IDENTIFIER,value['origin_library_id']):fail()
    number(value['revision'],1,2**53-1,True);save({k:value[k] for k in ('id','name','request_id','document')}|{'expected_revision':value['revision']-1})
    for key in ('created_at','updated_at'):
        if not isinstance(value[key],str):fail()
        datetime.fromisoformat(value[key].replace('Z','+00:00'))
    ids={s['id'] for s in sources(value['document'])};seen=set()
    if not isinstance(value['photo_links'],list):fail()
    for link in value['photo_links']:
        exact(link,('source_id','photo_id'))
        if link['source_id'] not in ids or link['source_id'] in seen or not matches(IDENTIFIER,link['photo_id']):fail()
        seen.add(link['source_id'])
    return value


def asset_path(sha,asset):
    """Validate managed snapshot metadata without loading runtime configuration."""
    if not matches(HASH,sha) or not isinstance(asset,dict) or set(asset)!={'path','storage_id'} or not matches(UUID,asset['storage_id']) or not isinstance(asset['path'],str):fail()
    path=Path(asset['path'])
    if not path.is_absolute():fail()
    path=path.resolve()
    if path.parts[-4:-2]!=('documents','collages') or path.parent.name!=asset['storage_id'] or path.name!=sha+'.bin':fail()
    return path


def stored_record(project_id,value,assets):
    record(value)
    hashes={s['sha256'] for s in sources(value['document'])}
    if value['id']!=project_id or not isinstance(assets,dict) or set(assets)!=hashes:fail()
    for sha,asset in assets.items():asset_path(sha,asset)
    return value
