"""Resolve metadata for a new batch, never for an existing saved frame draft."""
import base64
import copy
import hashlib
import json
from io import BytesIO
from pathlib import Path
from PIL import Image
from sqlalchemy import select
from ..models import LibraryProfile,FrameLibraryAsset,Session

ASSETS=Path(__file__).resolve().parents[1]/'assets'
NAMES=json.loads((ASSETS/'camera-name-map.json').read_text('utf-8'))
def key(v):return ' '.join((v or '').split()).lower()


def snapshot():
    with Session() as session:
        profile=session.get(LibraryProfile,1)
        aliases=((profile.preferences or {}).get('tools',{}).get('cameraNames',{}).get('aliases',[]) if profile else [])
        logos=[r.record for r in session.scalars(select(FrameLibraryAsset).where(FrameLibraryAsset.kind=='logos').order_by(FrameLibraryAsset.created_at,FrameLibraryAsset.id))]
    return copy.deepcopy(aliases),copy.deepcopy(logos)


def display_name(make,model,aliases):
    for alias in aliases:
        if (key(alias['make']),key(alias['model']))==(key(make),key(model)):return alias['name']
    return NAMES.get(key(make),{}).get(key(model),model or make or '')


def logo_for(make,logos):
    matched=next((l for l in reversed(logos) if l['make'] and key(l['make'])==key(make)),None)
    if matched:return copy.deepcopy(matched)
    sources=json.loads((ASSETS/'brand_logos'/'sources.json').read_text('utf-8'))
    brand=next((b for b in sources if key(make)==b or key(make).startswith(b+' ')),None)
    if not brand:return None
    with Image.open(ASSETS/'brand_logos'/(brand+'.png')) as original:
        image=original.convert('RGBA');image.info.clear();out=BytesIO();image.save(out,'PNG');width,height=image.size;image.close()
    data=out.getvalue()
    return {'id':'bundled-'+brand,'name':brand.upper(),'make':brand,'variant':'both','source':sources[brand],
        'license':'Manufacturer trademark. Existing PhotoCollection asset; see brand_logos/sources.json.',
        'data_url':'data:image/png;base64,'+base64.b64encode(data).decode(),'width':width,'height':height,'sha256':hashlib.sha256(data).hexdigest()}


def options_for(photo,options,context):
    result=copy.deepcopy(options);doc=result.get('frame_v2')
    if not doc or result.get('template')!='frame':return result
    aliases,logos=context
    tokens={'camera_make':photo.camera_make or '', 'camera_model':display_name(photo.camera_make,photo.camera_model,aliases),
        'raw_camera_model':photo.camera_model or '', 'lens_model':photo.lens_model or '',
        'date':(photo.date_taken or '').replace('T',' ')[:19], 'file_name':photo.file_name,
        'focal':f'{photo.focal_length:g}mm' if photo.focal_length else '',
        'aperture':f'f/{photo.f_number:g}' if photo.f_number else '',
        'shutter':f'{photo.exposure_time}s' if photo.exposure_time else '', 'iso':f'ISO {photo.iso}' if photo.iso else ''}
    doc['tokens']={**doc['tokens'],**tokens}
    if doc['logo_mode']=='auto':doc['logo']=logo_for(photo.camera_make,logos)
    return result
