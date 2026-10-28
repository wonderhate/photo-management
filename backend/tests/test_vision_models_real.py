"""Opt-in real CPU inference with downloaded public weights and synthetic photos.

PHOTO_TEST_VISION_MODELS must point inside this repository's .test-artifacts.
No model downloads or external requests are performed by this test.
"""
import os,json,hashlib,time
from pathlib import Path
from io import BytesIO
import pytest
from PIL import Image,ImageDraw
from starlette.datastructures import UploadFile
from backend.app.services import vision_models,vision_service,jobs
from backend.app.vision_schemas import VisionRequest
def wait_job(client,job,timeout=180):
    end=time.monotonic()+timeout
    while time.monotonic()<end:
        value=client.get('/api/jobs/'+job['id']).json()
        if value['status'] not in ('queued','running'):return value
        time.sleep(.05)
    raise AssertionError('Local inference did not finish in time.')

@pytest.mark.skipif(not os.environ.get('PHOTO_TEST_VISION_MODELS'),reason='Explicit local model fixture directory required')
@pytest.mark.parametrize('kind,model_id',[('depth','depth-anything-v2-small'),('segment','slimsam-uniform-50')])
def test_real_offline_model_roundtrip(client,tmp_path,kind,model_id,monkeypatch):
    fixture=Path(os.environ['PHOTO_TEST_VISION_MODELS']).resolve()
    root=Path(__file__).parents[2]/'.test-artifacts'
    assert fixture.is_relative_to(root.resolve())
    monkeypatch.setattr(vision_models,'MODELS',tmp_path/'models')
    spec=vision_models.spec(model_id);files=[]
    for item in spec['files']:
        path=fixture/'native'/model_id/item['name']
        assert path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest()==item['sha256']
        files.append(UploadFile(filename=item['name'],file=path.open('rb')))
    try:vision_models.import_files(model_id,files,True)
    finally:
        for f in files:f.file.close()
    image=Image.new('RGB',(320,240),'#467f91');draw=ImageDraw.Draw(image)
    draw.ellipse((90,20,230,160),fill='#dfb484');draw.rectangle((80,140,240,230),fill='#dd6644');draw.ellipse((265,20,315,80),fill='#eedc44')
    for x in range(90,230,3):draw.arc((x-12,8,x+12,70),180,350,fill='#231b16',width=2)
    output=BytesIO();image.save(output,'PNG');data=output.getvalue();digest=hashlib.sha256(data).hexdigest()
    payload=VisionRequest(kind=kind,model_id=model_id,source=dict(sha256=digest,width=320,height=240),name='Synthetic subjects',instances=[] if kind=='depth' else [dict(id='subject-1',points=[dict(x=.5,y=.4,label=1),dict(x=.05,y=.05,label=0),dict(x=.9,y=.2,label=0)],feather=1),dict(id='subject-2',points=[dict(x=.9,y=.2,label=1),dict(x=.5,y=.4,label=0)],feather=0)])
    job=vision_service.submit(payload,data)
    result=wait_job(client,job,timeout=180)
    assert result['status']=='completed',result
    assert len(result['results'])==(1 if kind=='depth' else 2)
    if kind=='segment':
        assert [r['instance_id'] for r in result['results']]==['subject-1','subject-2']
        assert result['results'][0]['asset_id']!=result['results'][1]['asset_id']
    asset_id=result['results'][0]['asset_id']
    asset=client.get('/api/vision/assets/'+asset_id).json()
    png=client.get('/api/vision/assets/'+asset_id+'/image').content
    assert hashlib.sha256(png).hexdigest()==asset_id and asset['source']['sha256']==digest
    with Image.open(BytesIO(png)) as actual:
        if kind=='depth':assert actual.convert('L').getextrema()[0]<actual.convert('L').getextrema()[1]
        else:
            alpha=actual.getchannel('A');assert alpha.getextrema()[0]<10 and alpha.getextrema()[1]>240
    assert hashlib.sha256(data).hexdigest()==digest
    if kind=='depth':
        cached=wait_job(client,vision_service.submit(payload,data),timeout=30)
        assert cached['results'][0]['asset_id']==asset_id
