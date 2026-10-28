"""Exercise bundled CPU inference with explicit offline public model fixtures."""
from contextlib import ExitStack
import hashlib
from io import BytesIO
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import httpx
from PIL import Image,ImageDraw


def main():
    root=Path(__file__).resolve().parents[1]
    executable=Path(sys.argv[1]).resolve(strict=True)
    fixture=Path(sys.argv[2]).resolve(strict=True)
    assert fixture.is_relative_to(root/'.test-artifacts')
    with tempfile.TemporaryDirectory(prefix='frozen-vision-',dir=root/'.test-artifacts') as temporary:
        work=Path(temporary);status=work/'status.json'
        env={k:v for k,v in os.environ.items() if k not in ('DASHSCOPE_API_KEY','OPENAI_API_KEY')}
        env.update(PHOTO_DATA_DIR=str(work/'data'),PHOTO_LIBRARY_CONFIG=str(work/'config.json'),
            PHOTO_MODELS_DIR=str(work/'models'),PHOTO_EXPORT_DIR=str(work/'exports'),LOCALAPPDATA=str(work/'profile'),PHOTO_AUTOLOAD_AI='0')
        process=subprocess.Popen([str(executable),'--serve','--status-file',str(status)],env=env,creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            deadline=time.monotonic()+90
            while not status.exists():
                if process.poll() is not None:raise RuntimeError('Frozen application exited')
                if time.monotonic()>deadline:raise TimeoutError('Frozen application startup timed out')
                time.sleep(.1)
            state=json.loads(status.read_text('utf-8'));assert Path(state['data_dir'])==work/'data'
            with httpx.Client(base_url=state['url'],trust_env=False,timeout=120) as client:
                def checked(response):response.raise_for_status();return response.json()
                models=checked(client.get('/api/vision/models'))
                assert len(models)==2 and all(m['dependency'] and not m['installed'] and m['network']=='never' for m in models)
                picture=Image.new('RGB',(320,240),'#467f91');draw=ImageDraw.Draw(picture)
                draw.ellipse((90,20,230,160),fill='#dfb484');draw.rectangle((80,140,240,230),fill='#dd6644');draw.ellipse((265,20,315,80),fill='#eedc44')
                output=BytesIO();picture.save(output,'PNG');raw=output.getvalue();digest=hashlib.sha256(raw).hexdigest()
                for model in models:
                    with ExitStack() as stack:
                        files=[]
                        for item in model['files']:
                            path=fixture/'native'/model['id']/item['name']
                            with path.open('rb') as stream:assert hashlib.file_digest(stream,'sha256').hexdigest()==item['sha256']
                            files.append(('files',(item['name'],stack.enter_context(path.open('rb')),'application/octet-stream')))
                        checked(client.post('/api/vision/models/'+model['id']+'/import',data={'confirmed':'true'},files=files))
                    kind='depth' if model['id']=='depth-anything-v2-small' else 'segment'
                    request={'kind':kind,'model_id':model['id'],'source':{'sha256':digest,'width':320,'height':240},'name':'Frozen synthetic subjects',
                        'instances':[] if kind=='depth' else [{'id':'subject-1','points':[{'x':.5,'y':.4,'label':1},{'x':.05,'y':.05,'label':0}],'feather':1}]}
                    job=checked(client.post('/api/vision/infer',data={'payload':json.dumps(request)},files={'file':('synthetic.png',raw,'image/png')}))
                    deadline=time.monotonic()+240
                    while time.monotonic()<deadline:
                        result=checked(client.get('/api/jobs/'+job['id']))
                        if result['status'] not in ('queued','running'):break
                        time.sleep(.2)
                    assert result['status']=='completed',result
                    asset_id=result['results'][0]['asset_id']
                    asset=checked(client.get('/api/vision/assets/'+asset_id))
                    image=client.get('/api/vision/assets/'+asset_id+'/image');image.raise_for_status()
                    assert hashlib.sha256(image.content).hexdigest()==asset_id and asset['source']['sha256']==digest
                    with Image.open(BytesIO(image.content)) as pixels:
                        channel=pixels.convert('L') if kind=='depth' else pixels.getchannel('A')
                        assert channel.getextrema()[0]<channel.getextrema()[1]
                    assert hashlib.sha256(raw).hexdigest()==digest
                    print('Frozen CPU model:',model['id'],'inference, asset hash and immutable source PASS',flush=True)
        finally:
            if process.poll() is None:process.terminate()
            process.wait(timeout=30)


if __name__=='__main__':main()
