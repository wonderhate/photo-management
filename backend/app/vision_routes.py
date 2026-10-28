from fastapi import APIRouter,UploadFile,File,Form,Query
from fastapi.responses import Response
from pydantic import Field
from .editor_schemas import StrictModel
from .vision_schemas import MAX_BYTES,VisionRequest
from .services import vision_assets,vision_models,vision_service

router=APIRouter(prefix='/api/vision',tags=['local-vision'])

class AssetUpdate(StrictModel):
    name:str|None=Field(default=None,min_length=1,max_length=120)
    hidden:bool|None=None

@router.get('/assets')
def assets(kind:str='sticker',page:int=Query(1,ge=1),include_hidden:bool=False):return vision_assets.list_assets(kind,page,include_hidden)

@router.post('/assets')
def import_png(file:UploadFile=File(...),name:str=Form(...)):
    return vision_assets.save(file.file.read(MAX_BYTES+1),name)

@router.get('/assets/{asset_id}/image')
def image(asset_id:str):return Response(vision_assets.read(asset_id),media_type='image/png',headers={'Cache-Control':'no-store'})

@router.get('/assets/{asset_id}')
def metadata(asset_id:str):
    from .models import Session,VisionAsset
    with Session() as session:return vision_assets.checked(session.get(VisionAsset,vision_assets.asset_id(asset_id))).record

@router.patch('/assets/{asset_id}')
def update(asset_id:str,payload:AssetUpdate):return vision_assets.update(asset_id,payload.name,payload.hidden)

@router.get('/models')
def models():return vision_models.status()

@router.post('/models/{model_id}/import')
def import_model(model_id:str,files:list[UploadFile]=File(...),confirmed:bool=Form(...)):
    return vision_models.import_files(model_id,files,confirmed)

@router.post('/infer')
def infer(file:UploadFile=File(...),payload:str=Form(...)):
    return vision_service.submit(VisionRequest.model_validate_json(payload),file.file.read(MAX_BYTES+1))
