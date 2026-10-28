from fastapi import APIRouter,Body,Request
from sqlalchemy import text
from .models import Session,Photo,PhotoLocation
from .services.photo_location import change,effective

router=APIRouter(prefix='/api/locations',tags=['local photo locations'])

@router.get('/discover')
def discover(day:str,count_mode:str='capture'):
    from .services.discover import summary
    return summary(day,count_mode)

@router.get('/map')
def get_map(request:Request):
    from .services.photo_map import summary
    params=dict(request.query_params);viewport=params.pop('viewport',None)
    return summary(params,viewport)

def view(photo,record):
    return dict(photo_id=photo.id,source_hash=photo.file_hash,record=record,effective=effective(photo,record),
                original=dict(latitude=photo.gps_latitude,longitude=photo.gps_longitude))

@router.get('/photos/{photo_id}')
def get_location(photo_id:str):
    with Session() as session:
        photo=session.get(Photo,photo_id)
        if photo is None:raise ValueError('Photo record no longer exists.')
        saved=session.get(PhotoLocation,photo_id)
        return view(photo,saved.record if saved else None)

@router.put('/photos/{photo_id}')
def update_location(photo_id:str,value:dict=Body(...)):
    # Serialize revision checks and writes; a second window must reload first.
    with Session() as session:
        session.execute(text('BEGIN IMMEDIATE'))
        photo=session.get(Photo,photo_id)
        if photo is None:raise ValueError('Photo record no longer exists.')
        saved=session.get(PhotoLocation,photo_id)
        record=change(photo,saved.record if saved else None,value)
        session.merge(PhotoLocation(photo_id=photo_id,record=record));session.commit()
        return view(photo,record)
