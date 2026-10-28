from fastapi import APIRouter,Query
from .services.derived_graph import snapshot

router=APIRouter(prefix='/api/assets',tags=['assets'])


@router.get('/graph')
def graph(kind:str=Query(max_length=30),id:str=Query(min_length=1,max_length=80)):
    return snapshot(kind,id)
