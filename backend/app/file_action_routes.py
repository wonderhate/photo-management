from typing import Annotated, Literal
from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field
from .services import file_actions

router = APIRouter(prefix='/api/file-actions', tags=['file-actions'])


class Transfer(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    photo_ids: list[Annotated[str, Field(min_length=1, max_length=80, pattern=r'^[a-zA-Z0-9-]+$')]] = Field(min_length=1, max_length=100)
    action: Literal['copy', 'drag']


@router.get('/capabilities')
def capabilities():
    return {'copy': file_actions.supported(), 'drag': file_actions.drag_supported(), 'effect': 'copy'}


@router.post('')
def transfer(payload: Transfer):
    return file_actions.transfer(file_actions.registered_photo_paths(payload.photo_ids), payload.action)
