import json
from typing import Literal
from fastapi import APIRouter,Form,File,UploadFile,Query,HTTPException
from fastapi.responses import FileResponse
from .services import collage_service as service
router=APIRouter(prefix='/api/editor/collages',tags=['local collage projects'])

@router.get('')
def listing(page:int=Query(1,ge=1),search:str=Query('',max_length=120),sort:Literal['updated','name']='updated',direction:Literal['asc','desc']='desc'):return service.list_projects(page,search,sort,direction)

@router.post('',status_code=201)
def save(payload:str=Form(...),files:list[UploadFile]=File(...)):
    try:
        if len(payload.encode('utf-8'))>2*1024*1024:raise ValueError()
        return service.save_project(json.loads(payload),files)
    except (ValueError,KeyError,TypeError) as error:raise HTTPException(422,'Invalid collage project.') from error

@router.get('/{project_id}')
def detail(project_id:str):return service.detail(project_id)

@router.get('/{project_id}/sources/{source_id}')
def source(project_id:str,source_id:str,revision:int=Query(...,ge=1)):
    path,name=service.source_path(project_id,source_id,revision)
    return FileResponse(path,filename=name,media_type='application/octet-stream')

@router.delete('/{project_id}')
def remove(project_id:str,revision:int=Query(...,ge=1)):return service.remove_project(project_id,revision)
