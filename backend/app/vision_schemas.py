"""Shared immutable local-vision asset contract (no paths or executable models)."""
import re
from typing import Literal
from pydantic import Field, model_validator
from .editor_schemas import StrictModel

Hash = str
MAX_PIXELS = 16_777_216
MAX_BYTES = 64*1024*1024

class VisionSource(StrictModel):
    sha256: str = Field(pattern=r'^[a-f0-9]{64}$')
    width: int = Field(ge=1, le=100_000_000)
    height: int = Field(ge=1, le=100_000_000)

    @model_validator(mode='after')
    def pixels(self):
        if self.width*self.height>100_000_000:raise ValueError('Invalid local vision asset.')
        return self

class VisionModel(StrictModel):
    id: Literal['depth-anything-v2-small','slimsam-uniform-50','slimsam-uniform-77']
    revision: str = Field(pattern=r'^[a-f0-9]{40,64}$')
    engine: Literal['transformers-cpu','onnx-wasm']
    license: Literal['Apache-2.0']

class VisionAsset(StrictModel):
    version: Literal[1]
    id: str = Field(pattern=r'^[a-f0-9]{64}$')
    kind: Literal['sticker','depth']
    name: str = Field(min_length=1,max_length=120)
    width: int = Field(ge=1,le=8192)
    height: int = Field(ge=1,le=8192)
    bytes: int = Field(ge=1,le=MAX_BYTES)
    created_at: str
    source: VisionSource | None
    model: VisionModel | None
    instance_id: str | None = Field(pattern=r'^[a-z0-9-]{1,80}$')
    hidden: bool

    @model_validator(mode='after')
    def valid(self):
        from datetime import datetime
        datetime.fromisoformat(self.created_at.replace('Z','+00:00'))
        if not self.name.strip() or re.search(r'[\x00-\x1f\x7f]',self.name) or self.width*self.height>MAX_PIXELS:raise ValueError('Invalid local vision asset.')
        if self.kind=='depth' and (not self.source or not self.model or self.model.id!='depth-anything-v2-small'):raise ValueError('Invalid local vision asset.')
        return self

class DepthOcclusion(StrictModel):
    asset_hash: str = Field(pattern=r'^[a-f0-9]{64}$')
    source_hash: str = Field(pattern=r'^[a-f0-9]{64}$')
    threshold: float = Field(ge=0,le=1)
    feather: float = Field(ge=0,le=.5)
    invert: bool

class VisionPoint(StrictModel):
    x: float = Field(ge=0,le=1)
    y: float = Field(ge=0,le=1)
    label: Literal[0,1]

class VisionInstance(StrictModel):
    id: str = Field(pattern=r'^[a-z0-9-]{1,80}$')
    points: list[VisionPoint] = Field(min_length=1,max_length=32)
    feather: float = Field(ge=0,le=8)

    @model_validator(mode='after')
    def foreground(self):
        if not any(p.label==1 for p in self.points):raise ValueError('Choose at least one foreground point for each subject.')
        return self

class VisionRequest(StrictModel):
    kind: Literal['depth','segment']
    model_id: Literal['depth-anything-v2-small','slimsam-uniform-50']
    photo_id: str|None=Field(default=None,pattern=r'^[a-zA-Z0-9-]{1,80}$')
    source: VisionSource
    name: str=Field(min_length=1,max_length=110)
    instances: list[VisionInstance]=Field(default_factory=list,max_length=8)

    @model_validator(mode='after')
    def instances_valid(self):
        if not self.name.strip() or re.search(r'[\x00-\x1f\x7f]',self.name):raise ValueError('Invalid local vision asset.')
        if (self.kind=='depth')!=(self.model_id=='depth-anything-v2-small'):raise ValueError('Invalid local vision model for this operation.')
        if self.kind=='depth' and self.instances or self.kind=='segment' and not self.instances or len({i.id for i in self.instances})!=len(self.instances):raise ValueError('Invalid local subject selection.')
        return self
