from fastapi import APIRouter,File,UploadFile,Response,Form,HTTPException
from pydantic import BaseModel,ConfigDict
from .services import lut_service as service

router=APIRouter(prefix='/api/editor/luts',tags=['local LUT library'])

class LutPatch(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True)
    favorite:bool|None=None
    hidden:bool|None=None

class LutVisibility(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True)
    hidden:bool

@router.post('/library/visibility')
def set_library_visibility(payload:LutVisibility):return service.set_library_hidden(payload.hidden)

@router.get('')
def list_luts():return service.list_assets()

@router.post('',status_code=201)
def import_lut(file:UploadFile=File(...),payload:str|None=Form(None),detailed:bool=False):
    import json
    try:
        options=json.loads(payload) if payload else {'groups':[]}
        if type(options) is not dict or set(options)!={'groups'}:raise ValueError()
    except (ValueError,TypeError):raise HTTPException(422,'Invalid LUT source context.')
    return service.import_asset(file,options['groups'],detailed)

@router.get('/{asset_id}/source')
def source(asset_id:str):return Response(service.source(asset_id),media_type='application/octet-stream',headers={'Cache-Control':'no-store'})

@router.patch('/{asset_id}')
def update(asset_id:str,payload:LutPatch):return service.update_asset(asset_id,payload.model_dump(exclude_none=True))

@router.post('/{asset_id}/used')
def note_used(asset_id:str):return service.note_used(asset_id)


from .services import lut_folder_service as folders
@router.post('/{asset_id}/reveal')
def reveal_source(asset_id:str):
    folders.reveal_external(asset_id)
    return {'ok':True}

class FolderRequest(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True)
    path:str
    id:str|None=None

@router.get('/folders')
def list_folders():return folders.list_folders()

@router.post('/folders')
def register_folder(payload:FolderRequest):return folders.register(payload.path,payload.id)

@router.post('/folders/{folder_id}/scan')
def scan_folder(folder_id:str):return folders.scan(folder_id)

@router.delete('/folders/{folder_id}')
def remove_folder(folder_id:str):folders.remove(folder_id);return {'ok':True}

@router.post('/{asset_id}/pin')
def pin_asset(asset_id:str):
    folders.ensure_asset(asset_id)
    return next(a for a in service.list_assets() if a['id']==asset_id)

@router.get('/{asset_id}/preview-source')
def preview_source(asset_id:str):
    from .models import Session,LutAsset
    with Session() as s:stored=s.get(LutAsset,asset_id)
    data=service.source(asset_id) if stored else folders.read_external(asset_id)
    return Response(data,media_type='application/octet-stream',headers={'Cache-Control':'no-store'})
