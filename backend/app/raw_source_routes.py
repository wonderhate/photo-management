from fastapi import APIRouter,Body
from .services import raw_sources,jobs

router=APIRouter(prefix='/api/raw-sources',tags=['manual RAW sources'])

@router.post('/register')
def register(value:dict=Body(...)):
    if set(value)!={'paths'}:raise ValueError('Choose a RAW source folder.')
    return jobs.submit('raw-source-index',raw_sources.register,raw_sources.paths(value['paths']))

@router.get('/photos/{photo_id}')
def suggestions(photo_id:str,q:str='',page:int=1,page_size:int=20):
    return raw_sources.suggestions(photo_id,q,page,page_size)

@router.put('/photos/{photo_id}')
def confirm(photo_id:str,value:dict=Body(...)):
    return raw_sources.confirm(photo_id,value)
