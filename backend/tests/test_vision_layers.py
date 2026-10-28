import io,json,hashlib
from pathlib import Path
import pytest
from PIL import Image
from backend.app.models import Session,VisionAsset
from backend.app.services import vision_assets
from backend.app.vision_schemas import VisionRequest
from backend.app.layer_stack import validate_layer_stack
from backend.tests.test_editor import create_edit,NEUTRAL

def png(kind='sticker'):
    im=Image.new('RGBA' if kind=='sticker' else 'L',(16,12),(120,180,80,0) if kind=='sticker' else 10)
    im.putpixel((8,6),(255,0,0,255) if kind=='sticker' else 240)
    out=io.BytesIO();im.save(out,'PNG');return out.getvalue()
def frame():return dict(source_width=640,source_height=480,crop=dict(x=0,y=0,width=1,height=1),rotation=0,angle=0,flipX=False,flipY=False)
def sticker(hash):return dict(id='sticker-00000000-0000-4000-8000-000000000001',kind='sticker',asset_hash=hash,name='Synthetic sticker',visible=True,locked=False,opacity=.8,x=.3,y=.4,rotation=15,width=480,height=360,scaleX=1.2,scaleY=.8,stroke=dict(enabled=True,color='#ffffff',width=3),shadow=dict(enabled=True,color='#000000',opacity=.5,x=0,y=3,blur=8),glow=dict(enabled=True,color='#ffd76a',opacity=.4,blur=12,passes=2))

def test_transparent_png_library_hash_metadata_hide_and_restore(client):
    r=client.post('/api/vision/assets',files={'file':('subject.png',png(),'image/png')},data={'name':'Subject'})
    assert r.status_code==200,r.text
    asset=r.json();assert asset['id']==hashlib.sha256(client.get('/api/vision/assets/'+asset['id']+'/image').content).hexdigest()
    assert len(client.get('/api/vision/assets').json()['items'])==1
    assert client.patch('/api/vision/assets/'+asset['id'],json={'hidden':True}).status_code==200
    assert not client.get('/api/vision/assets').json()['items']
    assert client.get('/api/vision/assets?include_hidden=true').json()['items'][0]['hidden']
    assert client.get('/api/vision/assets/'+asset['id']+'/image').status_code==200
    assert client.patch('/api/vision/assets/'+asset['id'],json={'hidden':False}).status_code==200
    with Session() as s:
        row=s.get(VisionAsset,asset['id']);row.png=b'broken';s.commit()
    assert client.get('/api/vision/assets/'+asset['id']+'/image').status_code==409

def test_layers_persist_without_touching_originals_and_depth_is_source_bound(client,image_factory):
    path=image_factory('vision-original.jpg');before=path.read_bytes();digest=hashlib.sha256(before).hexdigest()
    asset=vision_assets.save(png(),'Subject')
    model=dict(id='depth-anything-v2-small',revision='a'*40,engine='transformers-cpu',license='Apache-2.0')
    depth=vision_assets.save(png('depth'),'Depth',kind='depth',source=dict(sha256=digest,width=640,height=480),model=model)
    layer=sticker(asset['id']);layer['depth']=dict(asset_hash=depth['id'],source_hash=digest,threshold=.6,feather=.04,invert=False)
    stack=dict(version=2,frame=frame(),layers=[layer]);validate_layer_stack(stack)
    recipe=NEUTRAL|dict(version=4,composition=dict(source_width=640,source_height=480,angle=0),layer_stack=stack)
    edit=create_edit(client,path,recipe=recipe)
    assert edit['recipe']['layer_stack']==stack
    assert path.read_bytes()==before
    broken=json.loads(json.dumps(recipe));broken['layer_stack']['layers'][0]['depth']['source_hash']='0'*64
    payload=dict(source_name=path.name,source_hash=digest,recipe=broken)
    r=client.post('/api/editor/edits',data={'payload':json.dumps(payload)},files={'file':(path.name,before,'image/jpeg')})
    assert r.status_code==409 and path.read_bytes()==before
    with pytest.raises(ValueError):validate_layer_stack(dict(version=1,layers=[layer]))
    bad=json.loads(json.dumps(stack));bad['layers'][0]['scaleX']=0
    with pytest.raises(ValueError):validate_layer_stack(bad)

def test_missing_models_do_not_block_ordinary_editing(client,image_factory):
    models=client.get('/api/vision/models').json();assert all(not m['installed'] for m in models)
    path=image_factory('no-model-needed.jpg');edit=create_edit(client,path);assert edit['recipe']['version']==1
    payload=dict(kind='depth',model_id='depth-anything-v2-small',photo_id=None,source=dict(sha256=hashlib.sha256(path.read_bytes()).hexdigest(),width=640,height=480),name='Depth',instances=[])
    r=client.post('/api/vision/infer',data={'payload':json.dumps(payload)},files={'file':('input.png',png('depth'),'image/png')})
    assert r.status_code==409
    assert client.get('/api/editor/edits/'+edit['id']).status_code==200
    with pytest.raises(ValueError):VisionRequest.model_validate(payload|{'kind':'segment'})
    with pytest.raises(ValueError):VisionRequest.model_validate(payload|{'model_id':'remote-model','url':'https://example.test'})

def test_vision_manifests_are_pinned_and_shared_between_runtimes():
    root=Path(__file__).parents[2]
    native=json.loads((root/'backend/app/vision_models.json').read_text())
    browser=json.loads((root/'frontend/src/core/vision-models.json').read_text())
    assert native==browser
    for spec in native:
        assert spec['license']=='Apache-2.0' and len(spec['revision'])==40
        assert all(len(file['sha256'])==64 and file['bytes']>0 for file in spec['files'])
