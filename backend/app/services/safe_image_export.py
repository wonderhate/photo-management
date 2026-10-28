"""Encode to an owned temporary file, then publish without replacing any file."""
import hashlib
import os
import re
import shutil
from pathlib import Path
from tempfile import NamedTemporaryFile
from PIL import Image
from . import export_registry
from .image_decode import srgb_profile

FORMATS={'jpg':'JPEG','png':'PNG','webp':'WEBP'}


def digest(path,check=lambda:None):
    result=hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):
            check();result.update(block)
    return result.hexdigest()


def stem(name):
    name=re.sub(r'[<>:"/\\|?*\x00-\x1f]','_',name).strip('. ')[:160] or 'photo'
    name=re.sub(r'\.(jpg|jpeg|png|webp)$','',name,flags=re.I)
    if name.split('.')[0].upper() in {'CON','PRN','AUX','NUL',*[f'COM{i}' for i in range(1,10)],*[f'LPT{i}' for i in range(1,10)]}:name='_'+name
    return name or 'photo'


def _identity(path):
    stat=path.stat(follow_symlinks=False);return stat.st_dev,stat.st_ino


def publish_image(image:Image.Image,folder:Path,name:str,extension:str,quality:int,check=lambda:None):
    if extension not in FORMATS or type(quality) is not int or not 1<=quality<=100:
        raise ValueError('Invalid export settings.')
    if not folder.is_absolute():raise ValueError('Export directory must be an absolute path.')
    folder=folder.resolve();folder.mkdir(parents=True,exist_ok=True)
    if image.width*image.height>100_000_000 or max(image.size)>16000:
        raise ValueError('Export dimensions exceed 16000 pixels or 100 megapixels. Select a smaller output edge.')
    check();temp=None
    try:
        with NamedTemporaryFile(prefix='.photocollection-export-',suffix='.tmp',dir=folder,delete=False) as stream:
            temp=Path(stream.name)
            # Pixels-only output. No EXIF, GPS, author/source paths or XMP survive.
            encoded=image.copy();encoded.info.clear()
            try:encoded.save(stream,FORMATS[extension],quality=quality,icc_profile=srgb_profile())
            finally:encoded.close()
            stream.flush();os.fsync(stream.fileno())
        with Image.open(temp) as actual:
            if actual.format!=FORMATS[extension] or actual.size!=image.size:raise ValueError('Encoded image format or dimensions differ from the request.')
            actual.verify()
        return publish_file(temp,folder,name,extension,image.width,image.height,check)
    finally:
        if temp is not None:temp.unlink(missing_ok=True)


def publish_file(temp,folder,name,extension,width,height,check=lambda:None,metadata_policy='pixels-only-srgb'):
    if extension not in FORMATS or not folder.is_absolute():raise ValueError('Invalid export settings.')
    folder=folder.resolve();folder.mkdir(parents=True,exist_ok=True)
    hash=digest(temp,check);name=stem(name)
    for counter in range(100000):
        check();target=folder/f'{name}{"_"+str(counter) if counter else ""}.{extension}';identity=None
        try:
            try:os.link(temp,target);identity=_identity(target)
            except FileExistsError:continue
            except OSError:
                # FAT and some user-selected locations do not support hard links.
                try:
                    with target.open('xb') as stream:
                        identity=_identity(target)
                        with temp.open('rb') as source:shutil.copyfileobj(source,stream,1024*1024)
                        stream.flush();os.fsync(stream.fileno())
                except FileExistsError:continue
            check()
            if digest(target,check)!=hash:raise ValueError('Export verification failed; no successful result was recorded.')
            url=export_registry.register(target,sha256=hash)
            return {'file_name':target.name,'path':str(target),'url':url,'width':width,'height':height,
                    'sha256':hash,'format':extension,'metadata_policy':metadata_policy}
        except Exception:
            # Never remove a file another program replaced or modified.
            if identity is not None:
                try:
                    from .split_export_service import _source_prefix
                    if _identity(target)==identity and _source_prefix(target,temp):target.unlink()
                except OSError:pass
            raise
    raise ValueError('Too many export filename conflicts.')
