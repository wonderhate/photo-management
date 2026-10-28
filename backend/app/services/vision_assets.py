"""Immutable PNGs stored with their catalog; never changes source photographs."""
import hashlib
import io
from threading import RLock
from fastapi import HTTPException
from PIL import Image
from sqlalchemy import select
from ..models import Session,VisionAsset,now
from ..vision_schemas import VisionAsset as AssetRecord,MAX_BYTES,MAX_PIXELS

lock=RLock()

def checked(row):
    if row is None:raise HTTPException(404,'Local vision asset not found.')
    try:
        record=AssetRecord.model_validate(row.record)
        if record.id!=row.id or len(row.png)!=record.bytes or hashlib.sha256(row.png).hexdigest()!=row.id:raise ValueError()
    except (ValueError,TypeError):raise HTTPException(409,'Layer asset is missing or changed. Restore a backup.')
    return row

def asset_id(value):
    import re
    if not isinstance(value,str) or not re.fullmatch('[a-f0-9]{64}',value):raise HTTPException(422,'Invalid local vision asset.')
    return value

def clean_png(data,kind='sticker'):
    if not data or len(data)>MAX_BYTES:raise HTTPException(413,'Local vision asset exceeds the size limit.')
    try:
        with Image.open(io.BytesIO(data)) as original:
            if original.format!='PNG' or getattr(original,'n_frames',1)!=1 or original.width>8192 or original.height>8192 or original.width*original.height>MAX_PIXELS:raise ValueError()
            if kind=='sticker' and 'A' not in original.getbands() and 'transparency' not in original.info:raise ValueError()
            image=original.convert('RGBA' if kind=='sticker' else 'L');image.info.clear()
            if kind=='sticker' and image.getchannel('A').getextrema()==(255,255):raise ValueError()
            stream=io.BytesIO();image.save(stream,format='PNG');png=stream.getvalue()
            if len(png)>MAX_BYTES:raise ValueError()
            return png,image.size
    except (OSError,ValueError,Image.DecompressionBombError):raise HTTPException(422,'Use a non-animated transparent PNG within 16 megapixels.')

def save(data,name,*,kind='sticker',source=None,model=None,instance_id=None):
    png,(width,height)=clean_png(data,kind);id=hashlib.sha256(png).hexdigest()
    record=AssetRecord(version=1,id=id,kind=kind,name=name,width=width,height=height,bytes=len(png),created_at=now(),source=source,model=model,instance_id=instance_id,hidden=False).model_dump()
    with lock,Session() as session:
        row=session.get(VisionAsset,id)
        if row:
            # Identical PNGs may be reimported. Keep the first provenance.
            checked(row)
            if row.record['kind']!=kind or kind=='depth' and row.record['source']!=source:raise HTTPException(409,'Local vision asset provenance conflicts.')
            return row.record
        session.add(VisionAsset(id=id,kind=kind,record=record,png=png));session.commit();return record

def list_assets(kind='sticker',page=1,include_hidden=False):
    if kind not in ('sticker','depth') or type(page) is not int or page<1:raise HTTPException(422,'Invalid local vision asset.')
    # Metadata only; never read every PNG while browsing.
    with Session() as session:
        query=select(VisionAsset.record).where(VisionAsset.kind==kind)
        if not include_hidden:query=query.where(VisionAsset.record['hidden'].as_boolean()==False)
        rows=list(session.scalars(query.order_by(VisionAsset.id).offset((page-1)*24).limit(25)))
        for r in rows:AssetRecord.model_validate(r)
        return dict(items=rows[:24],more=len(rows)>24)

def read(id):
    with Session() as session:return checked(session.get(VisionAsset,asset_id(id))).png

def update(id,name=None,hidden=None):
    with lock,Session() as session:
        row=checked(session.get(VisionAsset,asset_id(id)));record=dict(row.record)
        if name is not None:record['name']=name
        if hidden is not None:record['hidden']=hidden
        AssetRecord.model_validate(record);row.record=record;session.commit();return record

def validate_recipe_assets(session,recipe,source_hash):
    recipe=recipe.model_dump(exclude_none=True) if hasattr(recipe,'model_dump') else recipe
    for layer in recipe.get('layer_stack',{}).get('layers',[]):
        if layer['kind']=='sticker':
            if checked(session.get(VisionAsset,asset_id(layer['asset_hash']))).record['kind']!='sticker':raise HTTPException(409,'Invalid local vision asset.')
        if layer.get('depth'):
            depth=layer['depth'];record=checked(session.get(VisionAsset,asset_id(depth['asset_hash']))).record
            if record['kind']!='depth' or depth['source_hash']!=source_hash or not record['source'] or record['source']['sha256']!=source_hash:raise HTTPException(409,'Depth asset belongs to a different source photo.')
