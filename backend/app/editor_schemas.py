from typing import Literal, Union
from math import cos, sin, pi
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator, TypeAdapter
from .source_decode import SourceDecodeProfile, LEGACY_SOURCE_DECODE


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False, strict=True)


class CropV1(StrictModel):
    x: float = Field(ge=0, lt=1)
    y: float = Field(ge=0, lt=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)

    @model_validator(mode='after')
    def inside_source(self):
        if self.x+self.width > 1.000001 or self.y+self.height > 1.000001:
            raise ValueError('Invalid crop.')
        return self


class ReferenceV1(StrictModel):
    mean: list[float] = Field(min_length=3, max_length=3)
    std: list[float] = Field(min_length=3, max_length=3)

    @model_validator(mode='after')
    def range_check(self):
        if any(abs(v)>200 for v in self.mean) or any(v<0 or v>200 for v in self.std):
            raise ValueError('Invalid reference colors.')
        return self


class EditRecipeV1(StrictModel):
    version: Literal[1]
    exposure: float = Field(ge=-5, le=5)
    contrast: float = Field(ge=-100, le=100)
    highlights: float = Field(ge=-100, le=100)
    shadows: float = Field(ge=-100, le=100)
    temperature: float = Field(ge=-100, le=100)
    tint: float = Field(ge=-100, le=100)
    saturation: float = Field(ge=-100, le=100)
    hue: float = Field(ge=-180, le=180)
    hslSaturation: float = Field(ge=-100, le=100)
    lightness: float = Field(ge=-100, le=100)
    curve: list[float] = Field(min_length=5, max_length=5)
    rotation: Literal[0,90,180,270]
    flipX: bool
    flipY: bool
    crop: CropV1
    sharpen: float = Field(ge=0, le=100)
    denoise: float = Field(ge=0, le=100)
    match: float = Field(ge=0, le=100)
    preserveLuminance: bool
    reference: ReferenceV1 | None = None

    @field_validator('version', 'rotation', mode='before')
    @classmethod
    def integer_literal(cls, value):
        if type(value) is not int:
            raise ValueError('Expected an integer.')
        return value

    @model_validator(mode='after')
    def curve_check(self):
        if any(v<0 or v>1 for v in self.curve):
            raise ValueError('Invalid edit recipe.')
        return self


class CropV2(StrictModel):
    x: float
    y: float
    width: float = Field(gt=0)
    height: float = Field(gt=0)


class CompositionV2(StrictModel):
    source_width: int = Field(ge=1,le=100_000_000)
    source_height: int = Field(ge=1,le=100_000_000)
    angle: float = Field(ge=-45,le=45)
    aspect: float | None = Field(default=None,gt=0,le=100_000_000)

    @field_validator('aspect',mode='before')
    @classmethod
    def optional_aspect(cls,value):
        if value is None:raise ValueError('Omit aspect for a free crop.')
        return value

    @model_validator(mode='after')
    def pixel_limit(self):
        if self.source_width*self.source_height>100_000_000:raise ValueError('Invalid composition.')
        return self


class EditRecipeV2(EditRecipeV1):
    version: Literal[2]
    crop: CropV2
    composition: CompositionV2

    @model_validator(mode='after')
    def composition_bounds(self):
        check_composition(self.crop,self.composition,self.rotation)
        return self


def check_composition(r: CropV2, g: CompositionV2, rotation: int):
    w,h=(g.source_height,g.source_width) if rotation in (90,270) else (g.source_width,g.source_height)
    cx,cy=r.x+r.width/2,r.y+r.height/2;c,s=cos(g.angle*pi/180),sin(g.angle*pi/180)
    for x,y in ((0,0),(1,0),(1,1),(0,1)):
        dx,dy=(x-.5)*r.width*w,(y-.5)*r.height*h
        u,v=cx+(c*dx+s*dy)/w,cy+(-s*dx+c*dy)/h
        if not -1e-6<=u<=1+1e-6 or not -1e-6<=v<=1+1e-6:raise ValueError('Invalid composition.')
    if g.aspect is not None and abs(r.width*w/(r.height*h)/g.aspect-1)>1e-6:raise ValueError('Invalid composition.')


class EditRecipeV3(EditRecipeV2):
    version: Literal[3]
    text_layers: dict

    @field_validator("text_layers")
    @classmethod
    def text_document(cls,value):
        from .text_layers import validate_text_layers
        validate_text_layers(value)
        return value


class EditRecipeV4(EditRecipeV2):
    version: Literal[4]
    layer_stack: dict

    @field_validator('layer_stack')
    @classmethod
    def layers(cls,value):
        from .layer_stack import validate_layer_stack
        validate_layer_stack(value)
        return value


class EditRecipeV5(EditRecipeV4):
    version: Literal[5]
    lut: dict | None = None

    @field_validator('lut',mode='before')
    @classmethod
    def lut_selection(cls,value):
        from .cube_lut import validate_lut_selection
        validate_lut_selection(value)
        return value


EditRecipe=Union[EditRecipeV1,EditRecipeV2,EditRecipeV3,EditRecipeV4,EditRecipeV5]
recipe_adapter=TypeAdapter(EditRecipe)


class EditCreate(StrictModel):
    photo_id: str | None = Field(default=None, pattern=r'^[a-zA-Z0-9-]{1,80}$')
    source_name: str = Field(min_length=1, max_length=255)
    source_hash: str = Field(pattern=r'^[a-f0-9]{64}$')
    recipe: EditRecipe
    decode_profile: SourceDecodeProfile = Field(default_factory=lambda: SourceDecodeProfile(**LEGACY_SOURCE_DECODE))


class EditUpdate(StrictModel):
    revision: int = Field(ge=1)
    source_hash: str = Field(pattern=r'^[a-f0-9]{64}$')
    recipe: EditRecipe


class VariantCreate(StrictModel):
    expected_recipe: EditRecipe | None = None
    document_id: str = Field(pattern=r'^[a-zA-Z0-9-]{1,80}$')
    document_revision: int = Field(ge=1)
    name: str = Field(min_length=1, max_length=255)
