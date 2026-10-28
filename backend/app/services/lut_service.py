from ..lut_context import validate_context,input_comments
"""Immutable, content-addressed local LUT library. Never modifies import files."""
import hashlib
from datetime import datetime,timezone
from threading import RLock
from fastapi import HTTPException,UploadFile
from sqlalchemy import select,update
from ..models import Session,LutAsset
from ..cube_lut import MAX_CUBE_BYTES,parse_cube,validate_lut_asset,HASH

lock=RLock()

def checked(row):
    if not row:raise HTTPException(404,'LUT not found.')
    try:
        validate_lut_asset(row.metadata_json)
        if row.id!=row.metadata_json['id'] or len(row.source)!=row.metadata_json['bytes'] or hashlib.sha256(row.source).hexdigest()!=row.id:raise ValueError()
    except (ValueError,TypeError):raise HTTPException(409,'LUT source changed. Restore a backup.')
    return row

def get(session,asset_id):
    if not HASH.fullmatch(asset_id):raise HTTPException(422,'Invalid LUT data.')
    return checked(session.get(LutAsset,asset_id))

def list_assets():
    with Session() as session:
        result=[]
        for asset_id,metadata in session.execute(select(LutAsset.id,LutAsset.metadata_json).order_by(LutAsset.id)):
            validate_lut_asset(metadata)
            if asset_id!=metadata['id']:raise HTTPException(409,'Invalid LUT data.')
            result.append(metadata)
        from .lut_folder_service import external_assets
        stored={a['id']:a for a in result}
        for asset in external_assets():stored.setdefault(asset['id'],asset)
        return list(stored.values())

def import_asset(file:UploadFile,groups=None,detailed=False):
    groups=[] if groups is None else groups
    try:validate_context(dict(groups=groups,comments=[]))
    except ValueError as error:raise HTTPException(422,str(error)) from error
    data=file.file.read(MAX_CUBE_BYTES+1)
    try:info=parse_cube(data)
    except ValueError as error:raise HTTPException(422,str(error)) from error
    asset_id=hashlib.sha256(data).hexdigest();name=(file.filename or 'Look.cube').replace('\\','/').rsplit('/',1)[-1]
    metadata=dict(version=2,context=dict(groups=groups,comments=input_comments(data.decode('utf-8-sig')[:65536])),id=asset_id,name=name,title=info['title'],size=info['size'],bytes=len(data),favorite=False,hidden=False,used_at=None)
    try:validate_lut_asset(metadata)
    except ValueError as error:raise HTTPException(422,'Invalid LUT data.') from error
    with lock,Session() as session:
        previous=session.get(LutAsset,asset_id)
        if previous:
            checked(previous);kind='restored' if previous.metadata_json['hidden'] else 'existing';previous.metadata_json={**previous.metadata_json,'version':2,'context':previous.metadata_json.get('context',metadata['context']),'hidden':False};metadata=previous.metadata_json
        else:kind='added';session.add(LutAsset(id=asset_id,metadata_json=metadata,source=data))
        session.commit();return dict(asset=metadata,kind=kind) if detailed else metadata

def update_asset(asset_id,patch):
    from .lut_folder_service import ensure_asset
    ensure_asset(asset_id)
    # Independent partial updates preserve concurrent favourite/recent changes.
    with lock,Session() as session:
        row=get(session,asset_id);metadata={**row.metadata_json,**patch}
        validate_lut_asset(metadata);row.metadata_json=metadata;session.commit();return metadata

def note_used(asset_id):
    return update_asset(asset_id,{'used_at':datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')})

def set_library_hidden(hidden):
    # One metadata transaction. Never load/rewrite source BLOBs or pin external files.
    with lock,Session() as session:
        assets=[];changes=[]
        for asset_id,metadata in session.execute(select(LutAsset.id,LutAsset.metadata_json)):
            validate_lut_asset(metadata)
            if asset_id!=metadata['id']:raise HTTPException(409,'Invalid LUT data.')
            next_metadata={**metadata,'hidden':hidden};assets.append(next_metadata)
            if metadata['hidden']!=hidden:changes.append({'id':asset_id,'metadata_json':next_metadata})
        if changes:session.execute(update(LutAsset),changes)
        session.commit();return {'assets':assets,'changed':len(changes)}

def source(asset_id):
    from .lut_folder_service import ensure_asset
    ensure_asset(asset_id)
    with Session() as session:return get(session,asset_id).source

def validate_recipe_asset(session,recipe):
    value=recipe.model_dump(exclude_none=True) if hasattr(recipe,'model_dump') else recipe
    if value.get('version')==5 and value.get('lut'):get(session,value['lut']['asset_hash'])
