"""Verify paired access using the built Windows EXE and synthetic read-only sources."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener, ProxyHandler
import zipfile

ROOT=Path(__file__).resolve().parents[1]
opener=build_opener(ProxyHandler({}))

def main():
    with tempfile.TemporaryDirectory(prefix='remote-package-',dir=ROOT/'.test-artifacts') as folder:
        data=Path(folder)
        env=os.environ|{'PHOTO_DATA_DIR':str(data/'library'),'PHOTO_EXPORT_DIR':str(data/'exports'),'PHOTO_MODELS_DIR':str(data/'models'),'PHOTO_LIBRARY_CONFIG':str(data/'config.json'),'PHOTO_AUTOLOAD_AI':'0'}
        exe=ROOT/'releases/windows/PhotoCollection/PhotoCollection.exe'
        process=subprocess.Popen([str(exe),'--serve','--port','8013','--duration','180'],env=env,creationflags=subprocess.CREATE_NO_WINDOW)
        base='http://127.0.0.1:8013'
        def call(path,method='GET',body=None,phone=False,cookie=''):
            headers={'Content-Type':'application/json'}
            if phone:headers|={'Host':'192.168.88.20:8013','User-Agent':'PhotoCollectionRemote/2','Cookie':cookie}
            request=Request(base+path,data=None if body is None else json.dumps(body).encode(),method=method,headers=headers)
            with opener.open(request,timeout=30) as response:
                payload=response.read()
                return (json.loads(payload) if response.headers.get_content_type()=='application/json' else payload),response.headers
        try:
            for _ in range(150):
                try:health,_=call('/api/health');break
                except (OSError,URLError):time.sleep(.2)
            else:raise AssertionError('Packaged server failed to start')
            assert health['version']=='2.2.0',health
            assert b'root' in call('/')[0]
            source=ROOT/'.test-artifacts/remote-client/synthetic-originals/Light-01.jpg'
            before=hashlib.sha256(source.read_bytes()).hexdigest()
            job,_=call('/api/photos/import','POST',{'paths':[str(source)],'recursive':False})
            for _ in range(200):
                job,_=call('/api/jobs/'+job['id'])
                if job['status']=='completed':break
                assert job['status'] not in ('failed','interrupted'),job
                time.sleep(.1)
            assert job['success']==1,job
            access,_=call('/api/remote/settings','PUT',{'enabled':True})
            try:call('/api/photos',phone=True)
            except HTTPError as error:assert error.code==401
            else:raise AssertionError('Unpaired phone was allowed')
            _,headers=call('/api/remote/connect','POST',{'code':access['pairing_code']},True)
            cookie=headers['Set-Cookie'].split(';')[0]
            listing,_=call('/api/photos',phone=True,cookie=cookie);photo=listing['photos'][0]
            changed,_=call('/api/photos/'+photo['id'],'PATCH',{'favorite':True,'tags':['phone']},True,cookie)
            assert changed['favorite'] and call('/api/photos/'+photo['id'])[0]['tags']==['phone']
            image,headers=call(photo['thumbnail_url'],phone=True,cookie=cookie)
            assert image and 'no-store' in headers['Cache-Control']
            draft,_=call('/api/watermark/drafts','POST',{'photo_id':photo['id'],'name':'Packaged phone draft','settings_json':{}},True,cookie)
            exported,_=call('/api/watermark/drafts/'+draft['id']+'/export','POST',{},True,cookie)
            image,headers=call(exported['url'],phone=True,cookie=cookie)
            assert image[:3]==b'\xff\xd8\xff' and 'no-store' in headers['Cache-Control']
            assert hashlib.sha256(source.read_bytes()).hexdigest()==before
            call('/api/remote/settings','PUT',{'enabled':False})
            try:call('/api/photos',phone=True,cookie=cookie)
            except HTTPError as error:assert error.code==403
            else:raise AssertionError('Disabled phone retained access')
        finally:
            process.terminate()
            try:process.wait(timeout=20)
            except subprocess.TimeoutExpired:process.kill();process.wait()
    with zipfile.ZipFile(ROOT/'releases/PhotoCollection-Windows.zip') as archive:
        names=archive.namelist()
        assert not any(Path(name).name in {'library.db','library-config.json','remote-access.json','android-password.txt'} or name.endswith(('.p12','.keystore')) for name in names)
        assert any(name.endswith('docs/android-remote.md') for name in names)
    print('PASS: built Windows 2.2.0 EXE pairing, desktop edits, drafts/export, image no-store, source hash, revocation and ZIP privacy')

if __name__=='__main__':main()
