"""Exercise the actual frozen executable against generated photos, never a user's library."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.request
from PIL import Image, TiffImagePlugin

def main() -> None:
    root = Path(__file__).resolve().parents[1]
    exe = Path(sys.argv[1]) if len(sys.argv)>1 else root/'releases/windows/PhotoCollection/PhotoCollection.exe'
    test_root = root/'.test-artifacts'
    test_root.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='windows-package-', dir=test_root) as folder:
        work=Path(folder); original=work/'test.jpg'
        exif=Image.Exif()
        for key,value in {272:'Package Test',42036:'85mm Test',37386:TiffImagePlugin.IFDRational(85),33437:TiffImagePlugin.IFDRational(28,10),33434:TiffImagePlugin.IFDRational(1,500),34855:100,36867:'2026:09:29 18:24:00'}.items(): exif[key]=value
        Image.new('RGB',(640,480),'orange').save(original,exif=exif)
        digest=hashlib.sha256(original.read_bytes()).digest()
        status=work/'status.json'
        env=os.environ | {'PHOTO_DATA_DIR':str(work/'data'), 'PHOTO_EXPORT_DIR':str(work/'exports'), 'PHOTO_MODELS_DIR':str(work/'models'), 'PHOTO_AUTOLOAD_AI':'0'}
        process=subprocess.Popen([str(exe),'--serve','--status-file',str(status)], env=env, creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            for _ in range(300):
                if status.exists(): break
                if process.poll() is not None: raise RuntimeError('Frozen executable exited before startup')
                time.sleep(.1)
            health=json.loads(status.read_text());url=health['url']
            opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
            def api(path,body=None,method=None):
                req=urllib.request.Request(url+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'},method=method)
                with opener.open(req,timeout=30) as response: return json.load(response)
            def job(result):
                for _ in range(400):
                    value=api('/api/jobs/'+result['id'])
                    if value['status'] in ('failed','completed'):
                        assert value['status']=='completed',value
                        return value
                    time.sleep(.05)
                raise TimeoutError('Frozen background job timed out')
            assert Path(health['data_dir'])==work/'data'
            assert len(health['build_id'])==16
            with opener.open(url) as response: assert b'<html' in response.read()
            assert job(api('/api/photos/import',{'paths':[str(original)]}))['success']==1
            assert job(api('/api/photos/import',{'paths':[str(original)]}))['skipped']==1
            photo=api('/api/photos')['photos'][0]
            assert photo['focal_length']==85 and photo['iso']==100
            assert api('/api/stats')['summary']['total']==1
            draft=api('/api/watermark/drafts',{'photo_id':photo['id'],'settings_json':{'template':'frame','signature':'包测试'}})
            exported=api('/api/watermark/drafts/'+draft['id']+'/export',{})
            assert exported,exported
            assert list((work/'exports').glob('*.jpg'))
            api('/api/watermark/drafts/'+draft['id'],method='DELETE')
            api('/api/photos/'+photo['id'],method='DELETE')
            assert original.exists() and hashlib.sha256(original.read_bytes()).digest()==digest
            print('Frozen EXE: startup, EXIF, dedup, statistics, draft, export, safe removal PASS')
        finally:
            process.terminate();process.wait(timeout=20)

if __name__=='__main__': main()
