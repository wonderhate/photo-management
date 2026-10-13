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
import urllib.error
from urllib.parse import urlsplit
from PIL import Image, TiffImagePlugin

def main() -> None:
    root = Path(__file__).resolve().parents[1]
    exe = Path(sys.argv[1]) if len(sys.argv)>1 else root/'releases/windows/PhotoCollection/PhotoCollection.exe'
    from ctypes import windll, create_string_buffer, c_void_p, c_uint, cast, POINTER, byref
    sys.path.insert(0, str(root))
    from backend.version import VERSION
    info = create_string_buffer(windll.version.GetFileVersionInfoSizeW(str(exe), None))
    assert info._length_ > 0, 'Executable must have Windows version metadata'
    assert windll.version.GetFileVersionInfoW(str(exe), 0, len(info), info)
    pointer, length = c_void_p(), c_uint()
    assert windll.version.VerQueryValueW(info, '\\', byref(pointer), byref(length))
    fixed = cast(pointer, POINTER(c_uint))
    actual = '.'.join(map(str, (fixed[2] >> 16, fixed[2] & 65535, fixed[3] >> 16)))
    assert actual == VERSION, (actual, VERSION)
    test_root = root/'.test-artifacts'
    test_root.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='windows-package-', dir=test_root) as folder:
        work=Path(folder); original=work/'test.jpg'
        exif=Image.Exif()
        for key,value in {272:'Package Test',42036:'85mm Test',37386:TiffImagePlugin.IFDRational(85),33437:TiffImagePlugin.IFDRational(28,10),33434:TiffImagePlugin.IFDRational(1,500),34855:100,36867:'2026:09:29 18:24:00'}.items(): exif[key]=value
        Image.new('RGB',(640,480),'orange').save(original,exif=exif)
        digest=hashlib.sha256(original.read_bytes()).digest()
        status=work/'status.json'
        check_ai='--ai' in sys.argv
        env=os.environ | {'PHOTO_DATA_DIR':str(work/'data'), 'PHOTO_LIBRARY_CONFIG':str(work/'config.json'), 'LOCALAPPDATA':str(work/'profile'), 'PHOTO_EXPORT_DIR':str(work/'exports'), 'PHOTO_MODELS_DIR':str(root/'models' if check_ai else work/'models'), 'PHOTO_AUTOLOAD_AI':'0'}
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
            endpoint=urlsplit(url)
            listeners={parts[1] for line in subprocess.check_output(['netstat','-ano','-p','tcp'],text=True).splitlines() if len(parts:=line.split())==5 and parts[3]=='LISTENING' and parts[1].endswith(f':{endpoint.port}')}
            assert listeners=={endpoint.netloc}, ('Server must listen on loopback only',listeners)
            assert not any(p.startswith(('/api/remote', '/api/files/browse')) for p in api('/openapi.json')['paths'])
            for path,headers,expected in [
                ('/api/remote/settings',{},404),('/api/remote/session',{},404),('/api/files/browse',{},404),
                ('/api/health',{'Host':'192.168.1.2','Cookie':'photo_remote=retired'},400),
                ('/api/health',{'Host':'public.example'},400),('/api/health',{'X-Forwarded-For':'127.0.0.1'},403),
            ]:
                try:
                    opener.open(urllib.request.Request(url+path,headers=headers),timeout=10)
                except urllib.error.HTTPError as error:
                    assert error.code==expected, (path,error.code)
                else:
                    raise AssertionError(f'Retired or remote request accepted: {path}')
            with opener.open(url) as response:
                assert b'<html' in response.read()
                assert response.headers['X-Content-Type-Options'] == 'nosniff'
                assert "frame-ancestors 'none'" in response.headers['Content-Security-Policy']
            assert job(api('/api/photos/import',{'paths':[str(original)]}))['success']==1
            assert job(api('/api/photos/import',{'paths':[str(original)]}))['skipped']==1
            photo=api('/api/photos')['photos'][0]
            assert photo['focal_length']==85 and photo['iso']==100
            assert api('/api/stats')['summary']['total']==1
            draft=api('/api/watermark/drafts',{'photo_id':photo['id'],'settings_json':{'template':'frame','signature':'包测试'}})
            exported=api('/api/watermark/drafts/'+draft['id']+'/export',{})
            assert exported,exported
            assert list((work/'exports').glob('*.jpg'))
            if check_ai:
                api('/api/ai/load?download=false',{})
                for _ in range(1200):
                    state=api('/api/ai/status')
                    if state['status'] in ('ready','error'): break
                    time.sleep(.1)
                assert state['status']=='ready',state
                assert state['indexed']==1,state
                embeddings=list((work/'data'/'embeddings').glob('*.npy'))
                assert len(embeddings)==1
                stamps={p:p.stat().st_mtime_ns for p in embeddings}
                candidates=api('/api/albums/smart/preview',{'keywords':['日落'],'threshold':-1,'max_results':10})
                assert len(candidates['candidates'])==1,candidates
                assert all(p.stat().st_mtime_ns==stamp for p,stamp in stamps.items()), 'Search must reuse embeddings'
                print('Frozen EXE: cached Chinese-CLIP CPU model and actual embedding PASS')
            api('/api/watermark/drafts/'+draft['id'],method='DELETE')
            api('/api/photos/'+photo['id'],method='DELETE')
            assert original.exists() and hashlib.sha256(original.read_bytes()).digest()==digest
            print('Frozen EXE: startup, EXIF, dedup, statistics, draft, export, safe removal PASS')
        finally:
            process.terminate();process.wait(timeout=20)

if __name__=='__main__': main()
