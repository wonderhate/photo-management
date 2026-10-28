from typing import Literal
from pydantic import BaseModel, Field
from .schemas import WatermarkOptions

class DraftCreate(BaseModel):
    photo_id: str
    name: str = Field(default='', max_length=180)
    template_id: str | None = Field(default=None, max_length=120)
    settings_json: WatermarkOptions = Field(default_factory=WatermarkOptions)

class DraftUpdate(BaseModel):
    revision: int = Field(ge=1)
    name: str | None = Field(default=None, min_length=1, max_length=180)
    template_id: str | None = Field(default=None, max_length=120)
    settings_json: WatermarkOptions | None = None

class DraftStatus(BaseModel):
    status: Literal['draft', 'ready']

class DraftExport(BaseModel):
    output_directory: str | None = Field(default=None, max_length=4096)
    format: Literal['jpg', 'png', 'webp'] | None = None
    quality: int | None = Field(default=None, ge=1, le=100)
    long_edge: int | None = Field(default=None, ge=0, le=16000)
    filename_template: str | None = Field(default=None, min_length=1, max_length=180)

class DraftBatchExport(DraftExport):
    draft_ids: list[str] = Field(min_length=1, max_length=1000)

class DraftRelocate(BaseModel):
    path: str
