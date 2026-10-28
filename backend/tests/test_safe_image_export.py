import hashlib
from pathlib import Path
import pytest
from PIL import Image
from backend.app.services import safe_image_export as output, export_registry


@pytest.mark.parametrize('extension,pillow_format',[('jpg','JPEG'),('png','PNG'),('webp','WEBP')])
def test_export_format_hash_metadata_and_collision(client,tmp_path,extension,pillow_format):
    original=tmp_path/('source.'+extension)
    with Image.new('RGB',(80,50),(150,80,30)) as image:
        image.save(original,pillow_format)
        before=original.read_bytes()
        image.info.update(exif=b'private GPS',xmp=b'private tags',comment='private comment')
        result=output.publish_image(image,tmp_path,'source',extension,91)
    assert result['path']!=str(original) and original.read_bytes()==before
    target=Path(result['path']);assert result['sha256']==hashlib.sha256(target.read_bytes()).hexdigest()
    with Image.open(target) as decoded:
        assert decoded.format==pillow_format and decoded.size==(80,50)
        assert not decoded.getexif() and not decoded.info.get('xmp')
        assert decoded.info.get('icc_profile')
    from urllib.parse import unquote
    key=unquote(result['url'].split('/')[-1]);assert export_registry.lookup(key)==target
    target.write_bytes(b'changed by another process')
    assert export_registry.lookup(key) is None


def test_failed_registration_removes_only_owned_output(client,tmp_path,monkeypatch):
    sentinel=tmp_path/'keep.jpg';sentinel.write_bytes(b'original')
    def fail(*args,**kwargs):raise OSError('synthetic registration failure')
    monkeypatch.setattr(export_registry,'register',fail)
    with Image.new('RGB',(30,20),'red') as image:
        with pytest.raises(OSError):output.publish_image(image,tmp_path,'keep','jpg',90)
    assert sentinel.read_bytes()==b'original'
    assert list(tmp_path.iterdir())==[sentinel]


def test_failed_registration_does_not_remove_replaced_target(client,tmp_path,monkeypatch):
    def replace_then_fail(target,**kwargs):
        target.unlink();target.write_bytes(b'external replacement');raise OSError('synthetic failure')
    monkeypatch.setattr(export_registry,'register',replace_then_fail)
    with Image.new('RGB',(30,20),'red') as image:
        with pytest.raises(OSError):output.publish_image(image,tmp_path,'keep','png',90)
    assert (tmp_path/'keep.png').read_bytes()==b'external replacement'


def test_editor_export_keeps_encoded_bytes_and_rejects_metadata(client):
    import io
    stream=io.BytesIO();Image.new('RGB',(40,30),'blue').save(stream,'WEBP',quality=90)
    result=client.post('/api/editor/exports',data={'name':'one.webp'},files={'file':('one.webp',stream.getvalue(),'image/webp')})
    assert result.status_code==201,result.text
    assert Path(result.json()['path']).read_bytes()==stream.getvalue()
    stream=io.BytesIO();exif=Image.Exif();exif[271]='private camera'
    Image.new('RGB',(40,30),'blue').save(stream,'JPEG',exif=exif)
    assert client.post('/api/editor/exports',data={'name':'private.jpg'},files={'file':('private.jpg',stream.getvalue(),'image/jpeg')}).status_code==422
