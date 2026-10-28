from fastapi import APIRouter,Body
from .services import removed_photos
from .services import derived_recycle

router=APIRouter(prefix='/api/removals',tags=['recoverable library records'])

@router.get('/photos')
def photos(page:int=1,page_size:int=40):return removed_photos.snapshot(page,page_size)

@router.post('/photos/restore')
def restore(value:dict=Body(...)):
    if set(value)!={'ids'}:raise ValueError('Invalid removal history selection.')
    return removed_photos.restore(value['ids'])

@router.get('/derived')
def derived(page:int=1):return derived_recycle.candidates(page)

@router.post('/derived')
def recycle(value:dict=Body(...)):
    if set(value)!={'items'}:raise ValueError('Invalid derived recycle record.')
    return derived_recycle.recycle(value['items'])

@router.get('/derived/history')
def recycle_history(page:int=1):return derived_recycle.history(page)

@router.post('/derived/{id}/restore')
def restore_derived(id:str):return derived_recycle.restore(id)
