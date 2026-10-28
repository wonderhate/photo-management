"""Versioned identity of an already-rendered split panel used as an edit source."""
from typing import Annotated, Literal
from pydantic import Field, field_validator, model_validator
from .editor_schemas import StrictModel, EditRecipeV1
from .split_schemas import Identifier, Hash, checked_split_metadata
from .source_decode import SourceDecodeProfile, LEGACY_SOURCE_DECODE

RecordID = Annotated[str, Field(pattern=r'^[a-zA-Z0-9-]{1,80}$')]
LINEAGE_ERROR = 'Unsupported or damaged edit source lineage. Restore a compatible backup.'


class SplitEditSource(StrictModel):
    version: Literal[1]
    kind: Literal['split-panel']
    group_id: Identifier
    variant_id: Identifier
    document_id: RecordID
    document_revision: int = Field(ge=1, le=9_007_199_254_740_991)
    panel_index: int = Field(ge=0, le=9)
    source_hash: Hash
    parent_source_hash: Hash
    master_hash: Hash
    width: int = Field(ge=1, le=100_000_000)
    height: int = Field(ge=1, le=100_000_000)

    @field_validator('version', mode='before')
    @classmethod
    def integer_version(cls, value):
        if type(value) is not int:raise ValueError('Unsupported edit source lineage.')
        return value

    @model_validator(mode='after')
    def dimensions_and_ids(self):
        if self.width*self.height>100_000_000 or len({self.group_id,self.variant_id,self.document_id})!=3:
            raise ValueError('Invalid edit source lineage.')
        return self


class SplitEditCreate(StrictModel):
    request_id: Identifier


def neutral_recipe() -> dict:
    # The panel bytes already contain the parent's grade, composition and rotation.
    return EditRecipeV1.model_validate(dict(version=1, exposure=0, contrast=0,
        highlights=0, shadows=0, temperature=0, tint=0, saturation=0, hue=0,
        hslSaturation=0, lightness=0, curve=[0,.25,.5,.75,1], rotation=0,
        flipX=False, flipY=False, crop=dict(x=0,y=0,width=1,height=1),
        sharpen=0, denoise=0, match=0, preserveLuminance=True)).model_dump(exclude_none=True)


def panel_descriptor(panel, master) -> SplitEditSource:
    part=checked_split_metadata(panel);whole=checked_split_metadata(master)
    def profile(row):return SourceDecodeProfile.model_validate(row.source_json.get('decode_profile',LEGACY_SOURCE_DECODE))
    if part is None or whole is None or part.index is None or whole.index is not None or part.model_dump(exclude={'index'})!=whole.model_dump(exclude={'index'}) or panel.document_id!=master.document_id or panel.document_revision!=master.document_revision or profile(panel)!=profile(master):
        raise ValueError(LINEAGE_ERROR)
    return SplitEditSource(version=1,kind='split-panel',group_id=master.id,variant_id=panel.id,
        document_id=panel.document_id,document_revision=panel.document_revision,panel_index=part.index,
        source_hash=panel.file_hash,parent_source_hash=part.source_hash,master_hash=part.master_hash,
        width=panel.width,height=panel.height)


def validate_chain(document, document_lookup, variant_lookup) -> SplitEditSource | None:
    """No application imports, disk reads, mutation or Python recursion."""
    first=None;seen=set()
    while True:
        if document.id in seen:raise ValueError(LINEAGE_ERROR)
        seen.add(document.id)
        if not isinstance(document.source_json,dict):raise ValueError(LINEAGE_ERROR)
        if 'derived_from' not in document.source_json:return first
        value=SplitEditSource.model_validate(document.source_json['derived_from'])
        if first is None:first=value
        profile=SourceDecodeProfile.model_validate(document.source_json.get('decode_profile'))
        if document.photo_id is not None or document.source_hash!=value.source_hash or profile.model_dump()!={'version':2,'extra_orientation':1} or document.id in (value.group_id,value.variant_id,value.document_id):raise ValueError(LINEAGE_ERROR)
        panel=variant_lookup(value.variant_id);master=variant_lookup(value.group_id);parent=document_lookup(value.document_id)
        if panel is None or master is None or parent is None or panel_descriptor(panel,master)!=value or parent.source_hash!=value.parent_source_hash or parent.revision<value.document_revision:raise ValueError(LINEAGE_ERROR)
        document=parent
