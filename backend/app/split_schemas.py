"""Frozen split geometry. Integer edges use JS-compatible positive half-up."""
from math import floor
from typing import Annotated, Literal
from pydantic import Field, field_validator, model_validator
from .editor_schemas import StrictModel, CropV2, CompositionV2, EditRecipe, EditRecipeV2, VariantCreate, check_composition, recipe_adapter

Hash=Annotated[str,Field(pattern=r'^[a-f0-9]{64}$')]
Identifier=Annotated[str,Field(pattern=r'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$')]


class SplitExport(StrictModel):
    request_id: Identifier
    output_directory: str | None = Field(default=None,max_length=4096)
    subfolder: bool = True


class SplitSize(StrictModel):
    width: int = Field(ge=1,le=100_000_000)
    height: int = Field(ge=1,le=100_000_000)

    @model_validator(mode='after')
    def area(self):
        if self.width*self.height>100_000_000:raise ValueError('Invalid seamless split.')
        return self


class SplitAspect(StrictModel):
    width: float = Field(ge=1,le=100)
    height: float = Field(ge=1,le=100)


class SplitSpec(StrictModel):
    version: Literal[1]
    aspect: SplitAspect
    count: int | None = Field(ge=2,le=10)
    region: CropV2
    basis: SplitSize
    angle: float = Field(ge=-45,le=45)

    @field_validator('version',mode='before')
    @classmethod
    def integer_version(cls,value):
        if type(value) is not int:raise ValueError('Invalid seamless split.')
        return value

    def resolved_count(self):
        return self.count if self.count is not None else max(2,min(10,floor(self.basis.width/(self.basis.height*(self.aspect.width/self.aspect.height)))))

    @model_validator(mode='after')
    def bounds(self):
        check_composition(self.region,CompositionV2(source_width=self.basis.width,source_height=self.basis.height,
            angle=self.angle,aspect=self.aspect.width/self.aspect.height*self.resolved_count()),0)
        return self


def panel_boundaries(width: int,count: int) -> list[int]:
    if type(width) is not int or type(count) is not int or not 2<=count<=10 or not count<=width<=100_000_000:
        raise ValueError('The split region needs at least one pixel per panel.')
    return [(2*i*width+count)//(2*count) for i in range(count+1)]


def split_plan(spec: SplitSpec) -> dict:
    width=max(1,floor(spec.region.width*spec.basis.width+.5));height=max(1,floor(spec.region.height*spec.basis.height+.5))
    SplitSize(width=width,height=height)
    count=spec.resolved_count();edges=panel_boundaries(width,count)
    return dict(width=width,height=height,count=count,edges=edges,
        panels=[dict(x=edges[i],y=0,width=edges[i+1]-edges[i],height=height) for i in range(count)])


def split_recipe(parent: dict,spec: SplitSpec) -> dict:
    recipe=recipe_adapter.validate_python(parent)
    source_width,source_height=(spec.basis.height,spec.basis.width) if recipe.rotation in (90,270) else (spec.basis.width,spec.basis.height)
    if spec.angle!=(recipe.composition.angle if recipe.version!=1 else 0):raise ValueError('Split source dimensions or angle changed. Reopen the split tool.')
    if recipe.version!=1 and (recipe.composition.source_width,recipe.composition.source_height)!=(source_width,source_height):raise ValueError('Split source dimensions or angle changed. Reopen the split tool.')
    return EditRecipeV2.model_validate(recipe.model_dump(exclude_none=True,exclude={'text_layers','layer_stack','lut'})|dict(version=2,crop=spec.region.model_dump(),
        composition=dict(source_width=source_width,source_height=source_height,angle=spec.angle,
        aspect=spec.aspect.width/spec.aspect.height*spec.resolved_count()))).model_dump(exclude_none=True)


class SplitCreate(VariantCreate):
    request_id: Identifier
    source_hash: Hash
    spec: SplitSpec
    format: Literal['png','jpg']
    quality: int = Field(ge=1,le=100)
    master_hash: Hash
    panel_hashes: list[Hash] = Field(min_length=2,max_length=10)

    @model_validator(mode='after')
    def all_panels(self):
        if len(self.panel_hashes)!=split_plan(self.spec)['count']:raise ValueError('Invalid seamless split.')
        return self


class SplitPanel(StrictModel):
    x: int = Field(ge=0)
    y: int = Field(ge=0,le=0)
    width: int = Field(ge=1)
    height: int = Field(ge=1)


class SplitPlan(SplitSize):
    count: int = Field(ge=2,le=10)
    edges: list[int] = Field(min_length=3,max_length=11)
    panels: list[SplitPanel] = Field(min_length=2,max_length=10)


class SplitLineage(StrictModel):
    version: Literal[1]
    group_id: Identifier
    panel_ids: list[Identifier] = Field(min_length=2,max_length=10)
    index: int | None = Field(ge=0,le=9)
    source_hash: Hash
    master_hash: Hash
    panel_hashes: list[Hash] = Field(min_length=2,max_length=10)
    spec: SplitSpec
    # Frozen explicitly and checked against the versioned rounding contract.
    plan: SplitPlan
    parent_recipe: EditRecipe
    format: Literal['png','jpg']
    quality: int = Field(ge=1,le=100)

    @field_validator('version',mode='before')
    @classmethod
    def integer_version(cls,value):
        if type(value) is not int:raise ValueError('Invalid seamless split.')
        return value

    @model_validator(mode='after')
    def relationships(self):
        expected=split_plan(self.spec)
        if self.plan.model_dump()!=expected or len(self.panel_ids)!=expected['count'] or len(set(self.panel_ids))!=len(self.panel_ids) or self.group_id in self.panel_ids or len(self.panel_hashes)!=len(self.panel_ids) or self.index is not None and self.index>=len(self.panel_ids):raise ValueError('Invalid seamless split.')
        split_recipe(self.parent_recipe.model_dump(exclude_none=True),self.spec)
        return self


def checked_split_metadata(row) -> SplitLineage | None:
    """Pure record validation for both HTTP services and offline maintenance."""
    if not row.kind.startswith('split') and isinstance(row.source_json,dict) and 'split' not in row.source_json:return None
    value=SplitLineage.model_validate(row.source_json['split'])
    master=value.index is None;index=value.index
    if row.kind!=('split-master' if master else 'split') or row.id!=(value.group_id if master else value.panel_ids[index]):raise ValueError('Invalid split identity.')
    rect=value.plan if master else value.plan.panels[index]
    if (row.width,row.height)!=(rect.width,rect.height) or row.file_hash!=(value.master_hash if master else value.panel_hashes[index]):raise ValueError('Invalid split pixels.')
    if row.recipe!=split_recipe(value.parent_recipe.model_dump(exclude_none=True),value.spec):raise ValueError('Invalid split recipe.')
    return value
