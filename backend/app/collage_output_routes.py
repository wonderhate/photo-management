import json
from fastapi import APIRouter,Form,File,UploadFile,Query,HTTPException
from fastapi.responses import FileResponse
from .services import collage_output_service as service
router=APIRouter(prefix='/api/editor/collage-outputs',tags=['local collage outputs'])
@router.get('')
def listing(page:int=Query(1,ge=1)):return service.listing(page)
@router.post('',status_code=201)
def save(payload:str=Form(...),file:UploadFile=File(...)):
    try:
        if len(payload)>4096:raise ValueError()
        return service.save(json.loads(payload),file)
    except (ValueError,TypeError,KeyError) as error:raise HTTPException(422,'Invalid collage output.') from error
@router.get('/{id}')
def detail(id:str):return service.detail(id)
@router.get('/{id}/image')
def image(id:str):
    path,format=service.image_path(id);return FileResponse(path,media_type='image/jpeg' if format=='jpg' else 'image/'+format,filename='Collage-'+id+'.'+format)
@router.get('/{id}/sources/{source_id}')
def source(id:str,source_id:str):
    path,name=service.source_path(id,source_id);return FileResponse(path,filename=name,media_type='application/octet-stream')
@router.delete('/{id}')
def remove(id:str):return service.remove(id)
