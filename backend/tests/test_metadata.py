"""Metadata supplementation never edits originals or the user's manual annotations."""
from hashlib import sha256
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from threading import Event
import time
import pytest
from PIL import Image, ImageCms, TiffImagePlugin
from backend.app.config import DATA
from backend.app.services import exiftool_service, metadata_service, jobs
from test_library import import_paths
from test_progressive_import import drained, eventually

ROOT=Path(__file__).resolve().parents[2]


def test_shared_metadata_contract_vectors_match_the_browser():
    vectors=json.loads((ROOT/'frontend/tests/fixtures/metadata-contract.json').read_text('utf-8'))
    blank={key:None for key in metadata_service.from_tags({})}
    for vector in vectors['cases']:
        assert metadata_service.from_tags(vector['tags'])==blank|vector['expected'],vector['name']
    for value,expected in vectors['shutters']:assert metadata_service.exif_service.shutter(value)==expected


def test_embedded_xmp_fills_missing_facts_before_sidecars_and_keeps_geometry_and_manual_values(client,tmp_path):
    import importlib.util
    spec=importlib.util.spec_from_file_location('metadata_jpegs',ROOT/'frontend/tests/fixtures/make-metadata-jpegs.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);module.create(tmp_path)
    source=tmp_path/'embedded.jpg';sidecar=write_xmp(source.with_suffix('.xmp'),'exif:ISOSpeedRatings="200" tiff:Orientation="6" xmp:Rating="5"')
    before=[digest(p) for p in (source,sidecar)]
    result=import_paths(client,[source]);drained();assert result['preview_failed']==0
    photo=client.get('/api/photos').json()['photos'][0];detail=client.get('/api/photos/'+photo['id']).json()
    assert (detail['iso'],detail['camera_model'],detail['exposure_time'])==(640,'XMP camera','0.3')
    # Preserve the existing Pillow fallback to embedded XMP orientation. Browser
    # v1 decoding differs here; a versioned decoder must retain old edit replay.
    assert (detail['width'],detail['height'],detail['orientation'])==(480,640,6)
    assert detail['rating']==5 and detail['rating_source']=='xmp-sidecar' and detail['tags']==[]
    assert json.loads(detail['raw_exif']['PhotoCollection:MetadataSources'])['orientation']=='original'
    assert detail['raw_exif']['xmp-embedded:XMP-exif:ISOSpeedRatings']=='640'
    assert [digest(p) for p in (source,sidecar)]==before


def test_native_rechecks_original_content_after_metadata_parsing(client,image_factory,monkeypatch):
    source=image_factory('changing-metadata.jpg');before=source.read_bytes();extract=metadata_service.extract
    def changed(*args):
        result=extract(*args);stat=source.stat();data=bytearray(source.read_bytes());data[-1]^=1;source.write_bytes(data)
        os.utime(source,ns=(stat.st_atime_ns,stat.st_mtime_ns));return result
    monkeypatch.setattr(metadata_service,'extract',changed)
    result=import_paths(client,[source]);drained()
    assert result['failed']==1 and client.get('/api/photos').json()['total']==0
    source.write_bytes(before);monkeypatch.setattr(metadata_service,'extract',extract)
    repaired=import_paths(client,[source]);drained();assert repaired['success']==1 and digest(source)==sha256(before).hexdigest()


def digest(path):return sha256(path.read_bytes()).hexdigest()


@pytest.fixture
def actual_tool(monkeypatch):
    script=ROOT/'.test-artifacts/exiftool-13.59/exiftool'
    located=os.environ.get('PHOTO_TEST_EXIFTOOL_PERL') or shutil.which('perl')
    git=shutil.which('git')
    perl=Path(located) if located else Path(git).parent.parent/'usr/bin/perl.exe' if git else Path('missing-perl')
    if not script.is_file() or not perl.is_file():pytest.skip('Optional pinned ExifTool source and installed Perl are unavailable')
    monkeypatch.setenv('PHOTO_EXIFTOOL',str(script));monkeypatch.setenv('PHOTO_EXIFTOOL_PERL',str(perl))
    assert subprocess.check_output([str(perl),str(script),'-config','','-ver'],text=True).strip()=='13.59'


def write_xmp(path,attributes='',body=''):
    document=f'''<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:exif="http://ns.adobe.com/exif/1.0/" xmlns:tiff="http://ns.adobe.com/tiff/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/" {attributes}>{body}</rdf:Description></rdf:RDF></x:xmpmeta>'''
    path.write_text(document,'utf-8');return path


def test_real_exiftool_batch_reads_unicode_numeric_gps_and_icc_without_changing_source(client,image_factory,tmp_path,actual_tool):
    source=image_factory('山海_é.jpg');plain=tmp_path/'plain.jpg'
    with Image.open(source) as original:
        exif=original.getexif();image=original.copy()
    rational=TiffImagePlugin.IFDRational
    exif[34853]={1:'S',2:(rational(34),rational(30),rational(0)),3:'W',4:(rational(123),rational(15),rational(0)),5:1,6:rational(20)}
    image.save(source,exif=exif);image.close()
    profile=ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
    Image.new('RGB',(45,90),'teal').save(plain,icc_profile=profile)
    broken=tmp_path/'bad.CR3';broken.write_bytes(b'unsupported synthetic metadata-only RAW')
    before=[digest(p) for p in (source,plain,broken)]
    rows=exiftool_service.read_batch([source,plain,broken]);assert source in rows and plain in rows and broken not in rows
    values=metadata_service.from_tags(rows[source]['tags'])
    assert values['camera_model']=='ILCE-7M4' and values['iso']==100 and values['exposure_seconds']==.002
    assert values['exposure_time']=='1/500' and values['f_number']==2.8 and values['orientation']==1
    assert (values['gps_latitude'],values['gps_longitude'],values['gps_altitude'])==(-34.5,-123.25,-20)
    assert any(key.endswith(':ProfileDescription') for key in rows[plain]['tags'])
    result=import_paths(client,[source,plain]);drained();assert result['success']==2 and result['preview_failed']==0
    photos=client.get('/api/photos').json()['photos']
    imported=next(p for p in photos if p['file_name']==plain.name)
    detail=client.get('/api/photos/'+imported['id']).json()
    assert 'sRGB' in detail['raw_exif']['ICC:ProfileDescription']
    assert any(key.startswith('exiftool:') for key in detail['raw_exif'])
    assert [digest(p) for p in (source,plain,broken)]==before
    assert not list((DATA/'previews'/'.metadata-read').glob('read-*'))


def test_real_exiftool_cr3_and_iiq_metadata_fixtures_are_read_only(tmp_path,actual_tool):
    # Vendor fixtures contain metadata, not complete sensor pixels: no RAW decode claim.
    originals=[ROOT/'.test-artifacts/exiftool-13.59/t/images'/name for name in ('CanonRaw.cr3','PhaseOne.iiq')]
    before=[digest(p) for p in originals];paths=[]
    for source in originals:
        target=tmp_path/source.name;shutil.copyfile(source,target);paths.append(target)
    rows=exiftool_service.read_batch(paths);assert set(rows)==set(paths)
    expected=[('Canon EOS M50',12800,'1/80'),('Credo 40',100,'1/1250')]
    for path,(model,iso,exposure) in zip(paths,expected):
        values=metadata_service.extract(path,rows[path],digest(path))
        assert (values['camera_model'],values['iso'],values['exposure_time'])==(model,iso,exposure)
        assert values['lens_model']
    assert [digest(p) for p in originals]==before and [digest(p) for p in paths]==before


def test_xmp_supplements_only_missing_fields_and_keeps_manual_annotations_and_geometry(client,tmp_path):
    source=tmp_path/'blank.jpg';Image.new('RGB',(80,40),'green').save(source)
    shared=write_xmp(source.with_suffix('.xmp'),'exif:ISOSpeedRatings="800" xmp:Rating="5" xmp:Label="Red"',
        '<dc:subject><rdf:Bag><rdf:li>external</rdf:li><rdf:li>旅途</rdf:li></rdf:Bag></dc:subject>')
    specific=write_xmp(source.with_name(source.name+'.xmp'),'exif:ISOSpeedRatings="200" exif:DateTimeOriginal="2026-10-22T19:23:45+08:00" tiff:Orientation="6" tiff:ImageWidth="999"')
    before=[digest(p) for p in (source,shared,specific)];result=import_paths(client,[source]);drained();assert result['preview_failed']==0
    photo=client.get('/api/photos').json()['photos'][0];detail=client.get('/api/photos/'+photo['id']).json()
    assert detail['iso']==200 and detail['date_taken']=='2026-10-22T19:23:45'
    assert (detail['width'],detail['height'],detail['orientation'])==(80,40,1)
    assert detail['rating']==5 and detail['rating_source']=='xmp-sidecar' and detail['color_label'] is None and detail['tags']==[]
    assert json.loads(detail['raw_exif']['xmp-sidecar:XMP-dc:subject'])==['external','旅途']
    assert json.loads(detail['raw_exif']['PhotoCollection:MetadataSources'])['iso']=='xmp-sidecar'
    assert sum(key.endswith(':SHA256') for key in detail['raw_exif'])==2
    client.patch('/api/photos/'+photo['id'],json={'rating':3,'color_label':'blue','tags':['manual']})
    import_paths(client,[source]);drained();detail=client.get('/api/photos/'+photo['id']).json()
    assert (detail['rating'],detail['color_label'],detail['tags'])==(3,'blue',['manual'])
    assert [digest(p) for p in (source,shared,specific)]==before


def test_original_exif_wins_and_stale_exiftool_supplements_are_rejected(image_factory):
    source=image_factory();before=digest(source)
    tags={'IFD0:Model':'different camera','ExifIFD:ISO':800,'ExifIFD:ExposureTime':.25,'IFD0:Orientation':6}
    result=metadata_service.extract(source,{'sha256':before,'tags':tags},before)
    assert result['camera_model']=='ILCE-7M4' and result['iso']==100 and result['exposure_time']=='1/500' and result['orientation']==1
    assert result['raw_exif']['exiftool:IFD0:Model']=='different camera'
    stale=metadata_service.extract(source,{'sha256':'0'*64,'tags':tags},before)
    assert not any(key.startswith('exiftool:') for key in stale['raw_exif']) and digest(source)==before


def test_metadata_numeric_gps_wall_clock_and_unknowns_are_normalized():
    tags={'GPS:GPSLatitude':34.5,'GPS:GPSLatitudeRef':'S','GPS:GPSLongitude':123.25,'GPS:GPSLongitudeRef':'W',
        'GPS:GPSAltitude':20,'GPS:GPSAltitudeRef':1,'ExifIFD:ExposureTime':'1/125','ExifIFD:FNumber':'28/10',
        'ExifIFD:DateTimeOriginal':'2026:10:22 19:23:45+08:00','XMP-xmp:CreateDate':'2020-01-01T00:00:00Z',
        'ExifIFD:ISO':False,'IFD0:Orientation':9}
    values=metadata_service.from_tags(tags)
    assert (values['gps_latitude'],values['gps_longitude'],values['gps_altitude'])==(-34.5,-123.25,-20)
    assert values['date_taken']=='2026-10-22T19:23:45' and values['exposure_time']=='1/125' and values['f_number']==2.8
    assert values['iso'] is None and values['orientation'] is None
    invalid=metadata_service.from_tags({'GPS:GPSLatitude':91,'ExifIFD:ExposureTime':0,'ExifIFD:ISO':'NaN'})
    assert invalid['gps_latitude'] is None and invalid['exposure_time'] is None and invalid['iso'] is None
    huge=metadata_service.from_tags({'ExifIFD:ISO':'1e30','File:ImageWidth':20000,'File:ImageHeight':20000})
    assert huge['iso'] is None and huge['width'] is None and huge['height'] is None


def test_bad_large_or_entity_xmp_is_ignored_and_utf16_is_supported(tmp_path):
    source=tmp_path/'source.xmp'
    for data in [b'broken xml',b'x'*(metadata_service.MAX_XMP+1),b'<!DOCTYPE doc [<!ENTITY x "bad">]><doc>&x;</doc>',
        '<!DOCTYPE doc [<!ENTITY x "bad">]><doc>&x;</doc>'.encode('utf-16'),
        ('<doc>'*40+'</doc>'*40).encode(),('<doc>'+'<node/>'*4100+'</doc>').encode()]:
        source.write_bytes(data);assert metadata_service.read_xmp(source)=={}
    write_xmp(source,'exif:ISOSpeedRatings="400"','<tiff:Model>Mixed<!-- comment --><![CDATA[ & raw]]></tiff:Model>');source.write_bytes(source.read_text('utf-8').encode('utf-16'))
    assert metadata_service.read_xmp(source)['tags']['XMP-exif:ISOSpeedRatings']=='400'
    assert metadata_service.read_xmp(source)['tags']['XMP-tiff:Model']=='Mixed & raw'


def test_missing_optional_tool_is_a_soft_fallback(image_factory,monkeypatch):
    monkeypatch.setenv('PHOTO_EXIFTOOL','Z:/missing/exiftool.exe');source=image_factory();before=digest(source)
    assert exiftool_service.command() is None and exiftool_service.read_batch([source])=={}
    assert metadata_service.extract(source)['camera_model']=='ILCE-7M4' and digest(source)==before


def fake_reader(tmp_path,monkeypatch,body):
    helper=tmp_path/'reader.py';helper.write_text(body,'utf-8')
    monkeypatch.setattr(exiftool_service,'command',lambda:[sys.executable,str(helper)])
    return helper


def test_optional_reader_cancel_and_timeout_terminate_owned_processes_and_clean_files(client,image_factory,tmp_path,monkeypatch):
    drained();source=image_factory();before=digest(source);started=Event();processes=[]
    fake_reader(tmp_path,monkeypatch,'''import time,sys,subprocess,os
from pathlib import Path
if os.name=='nt':
    child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)'],creationflags=subprocess.CREATE_NO_WINDOW)
    Path(__file__).with_suffix('.pid').write_text(str(child.pid))
time.sleep(30)
''')
    launch=exiftool_service.subprocess.Popen
    def observed(args,*pos,**kw):
        process=launch(args,*pos,**kw)
        if args[0]==sys.executable:processes.append(process);started.set()
        return process
    monkeypatch.setattr(exiftool_service.subprocess,'Popen',observed)
    root=jobs.submit('import',lambda job:exiftool_service.read_batch([source],job))
    assert started.wait(3)
    if os.name=='nt':eventually(lambda:(tmp_path/'reader.pid').is_file())
    jobs.cancel(root['id']);drained()
    assert jobs.get(root['id'])['status']=='cancelled' and all(p.poll() is not None for p in processes)
    def assert_child_stopped():
        if os.name!='nt':return
        import ctypes
        from ctypes import wintypes
        kernel=ctypes.WinDLL('kernel32',use_last_error=True)
        kernel.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD];kernel.OpenProcess.restype=wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes=[wintypes.HANDLE,wintypes.DWORD];kernel.WaitForSingleObject.restype=wintypes.DWORD
        kernel.CloseHandle.argtypes=[wintypes.HANDLE]
        handle=kernel.OpenProcess(0x100000,False,int((tmp_path/'reader.pid').read_text()))
        if handle:
            try:assert kernel.WaitForSingleObject(handle,0)!=258
            finally:kernel.CloseHandle(handle)
    assert_child_stopped()
    monkeypatch.setattr(exiftool_service,'TIMEOUT',.1)
    assert exiftool_service.read_batch([source])=={} and all(p.poll() is not None for p in processes)
    assert_child_stopped()
    assert digest(source)==before and not list((DATA/'previews'/'.metadata-read').glob('read-*'))


def test_reader_changed_source_and_invalid_or_large_output_are_soft_misses(client,image_factory,tmp_path,monkeypatch):
    source=image_factory();before=source.read_bytes()
    fake_reader(tmp_path,monkeypatch,'''import sys,json,os
from pathlib import Path
source=Path(Path(sys.argv[-1]).read_text('utf-8').strip());stat=source.stat()
data=bytearray(source.read_bytes());data[-1]^=1;source.write_bytes(data);os.utime(source,ns=(stat.st_atime_ns,stat.st_mtime_ns))
print(json.dumps([{'SourceFile':str(source),'IFD0:Model':'stale'}]))
''')
    assert exiftool_service.read_batch([source])=={} and source.read_bytes()!=before
    source.write_bytes(before)
    for body in ['print("not json")','print("x"*2200000)']:
        fake_reader(tmp_path,monkeypatch,body);assert exiftool_service.read_batch([source])=={}
    assert source.read_bytes()==before and not list((DATA/'previews'/'.metadata-read').glob('read-*'))
