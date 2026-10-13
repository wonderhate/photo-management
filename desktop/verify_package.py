"""Exercise the actual frozen executable against generated photos, never a user's library."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import sqlite3
from uuid import uuid4
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
        env.pop('OPENAI_API_KEY', None)
        env.pop('DASHSCOPE_API_KEY', None)
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
            listeners={parts[1] for line in subprocess.check_output(['netstat','-ano','-p','tcp'],text=True,encoding='oem').splitlines() if len(parts:=line.split())==5 and parts[3]=='LISTENING' and parts[1].endswith(f':{endpoint.port}')}
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
            with opener.open(url+'/watercolor') as response:
                assert b'<html' in response.read()
            config=api('/api/art/settings')
            assert config['provider']=='Qwen' and config['image_model']=='qwen-image-3.0'
            assert config['endpoint']=='https://maas.qianwenaiapi.com/api/v1/services/aigc/multimodal-generation/generation'
            api('/api/art/settings',{'image_model':'qwen-image-3.0-pro'},'PUT')
            assert api('/api/art/settings')['image_model']=='qwen-image-3.0-pro'
            configured=api('/api/art/settings',{'api_key':'package-test-key-not-real'},'PUT')
            assert configured['configured'] and 'package-test-key-not-real' not in json.dumps(configured)
            assert b'package-test-key-not-real' not in (work/'data'/'qwen-art-key.dpapi').read_bytes()
            api('/api/art/settings',{'clear_key':True},'PUT')
            assert not api('/api/art/settings')['configured']
            # Seed a clearly synthetic scene to test frozen layout/fonts without a cloud request.
            aid=str(uuid4());folder=work/'data'/'artworks'/aid;folder.mkdir(parents=True)
            scene=Image.new('RGB',(640,480),'cornflowerblue')
            scene.save(folder/'scene.png');scene.save(folder/'poster-1.png');scene.save(folder/'preview-1.webp')
            source={'file_name':'package-watercolor.png','width':640,'height':480,'date_taken':photo['date_taken'],'camera_model':'Package Test','iso':100}
            layout={'title':'包测试','title_source':'manual','title_evidence':'','layout':'airy','font':'chinese_handwriting','paper':.35}
            with sqlite3.connect(work/'data'/'library.db') as db:
                db.execute('INSERT INTO artworks (id,photo_id,source_json,settings_json,generation_json,width,height,revision,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
                           (aid,photo['id'],json.dumps(source),json.dumps(layout),'{}',640,480,1,'2026-10-13T00:00:00Z'))
            db.close()
            artwork=api('/api/art/works/'+aid,{'revision':1,'layout':layout|{'title':'旅行 · wonder','layout':'reference'}},'PUT')
            assert artwork['revision']==2 and artwork['layout']['title']=='旅行 · wonder'
            art_export=api('/api/art/works/'+aid+'/export',{'format':'png'})
            assert Path(art_export['path']).is_file()
            art_draft=api('/api/art/works/'+aid+'/watermark',{})
            assert art_draft['artwork_id']==aid and art_draft['source']['artwork_revision']==2
            assert api('/api/watermark/drafts/'+art_draft['id']+'/export',{})['width']>0
            api('/api/watermark/drafts/'+art_draft['id'],method='DELETE')
            api('/api/art/works/'+aid,method='DELETE')
            print('Frozen EXE: watercolor route, Windows credential encryption, Chinese layout, export and watermark handoff PASS')
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
