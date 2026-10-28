"""Small, whitelisted UI preferences; no recipes, paths or credentials."""
from typing import Literal
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator, ValidationError
from sqlalchemy import text
from .models import Session, LibraryProfile, EditDocument, DocumentViewPreference
from .ai_schemas import TransferredProfile

router = APIRouter(prefix='/api/workspace', tags=['workspace'])


@router.get('/capabilities')
def capabilities():
    from .services.capability_service import snapshot
    return snapshot()


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, allow_inf_nan=False)


class GalleryPreferences(StrictModel):
    layout: Literal['justified','grid','tiles','waterfall'] | None = None
    grid: int | None = Field(default=None, ge=150, le=380)
    gap: int | None = Field(default=None, ge=8, le=36)
    radius: int | None = Field(default=None, ge=0, le=18)
    dense: bool | None = None
    sort: Literal['date_taken','created_at','file_name','rating'] | None = None
    direction: Literal['asc','desc'] | None = None

    @model_validator(mode='after')
    def no_null_fields(self):
        if any(getattr(self, key) is None for key in self.model_fields_set):
            raise ValueError('Preference values cannot be null.')
        return self


class GalleryPatch(StrictModel):
    library_id: str = Field(min_length=1, max_length=80, pattern=r'^[a-zA-Z0-9-]+$')
    values: GalleryPreferences


class AlbumPreferences(StrictModel):
    sort: Literal['custom','name','created_at','count'] | None = None
    direction: Literal['asc','desc'] | None = None
    order: list[str] | None = Field(default=None,max_length=10000)
    view: Literal['cards','table'] | None = None

    @model_validator(mode='after')
    def bounded_values(self):
        import re
        if any(getattr(self,key) is None for key in self.model_fields_set):raise ValueError('影集列表设置无效')
        if self.order is not None and (len(set(self.order))!=len(self.order) or any(not re.fullmatch(r'[a-zA-Z0-9-]{1,80}',item) for item in self.order)):raise ValueError('影集列表设置无效')
        return self


class AlbumPatch(StrictModel):
    library_id: str = Field(min_length=1,max_length=80,pattern=r'^[a-zA-Z0-9-]+$')
    values: AlbumPreferences


class FacetPreferences(StrictModel):
    hidden: list[str] | None = Field(default=None,max_length=21)

    @model_validator(mode='after')
    def valid_fields(self):
        from .services.photo_facets import FACETS
        if 'hidden' in self.model_fields_set and (self.hidden is None or len(set(self.hidden))!=len(self.hidden) or any(f not in FACETS for f in self.hidden)):raise ValueError('Invalid filter bar preferences.')
        return self


class FacetPatch(StrictModel):
    library_id: str = Field(min_length=1,max_length=80,pattern=r'^[a-zA-Z0-9-]+$')
    values: FacetPreferences


class ToolFields(StrictModel):
    @model_validator(mode='before')
    @classmethod
    def exact_values(cls,value):
        if isinstance(value,dict):
            if any(v is None for v in value.values()):raise ValueError('Null tool preference.')
            for key in ('quality','edge'):
                if key in value and type(value[key]) is not int:raise ValueError('Integer tool preference required.')
        return value


class ViewerPreferences(ToolFields):
    quality: Literal[0,4096,6144] | None = None
    pinned: bool | None = None


class DiscoverPreferences(ToolFields):
    expanded: bool | None = None
    memories: bool | None = None
    people: bool | None = None
    places: bool | None = None
    albums: bool | None = None


class ComparePreferences(ToolFields):
    linked: bool | None = None


class DarkroomPreferences(ToolFields):
    format: Literal['jpg','png','webp'] | None = None
    edge: int | None = Field(default=None,ge=0,le=16000)
    quality: int | None = Field(default=None,ge=1,le=100)


class SplitPreferences(ToolFields):
    width: float | None = Field(default=None,ge=1,le=100,allow_inf_nan=False)
    height: float | None = Field(default=None,ge=1,le=100,allow_inf_nan=False)

    @model_validator(mode='before')
    @classmethod
    def numeric_sides(cls,value):
        if isinstance(value,dict) and any(type(v) not in (int,float) for v in value.values()):
            raise ValueError('Numeric split preference required.')
        return value


class LutPreferences(ToolFields):
    # Independent hash-addressed marks merge without replacing another window's marks.
    model_config=ConfigDict(extra='allow',strict=True,allow_inf_nan=False)

    @model_validator(mode='before')
    @classmethod
    def valid_values(cls,value):
        import re,math
        if not isinstance(value,dict):raise ValueError('Invalid LUT view preferences.')
        for key,item in value.items():
            if re.fullmatch(r'collapse:(favorite|recent|other|hidden)',key):
                if type(item) is not bool:raise ValueError('Invalid LUT view preferences.')
                continue
            if re.fullmatch(r"fold:(?:[a-f0-9-]{36}|library):[a-zA-Z0-9%_.!~*'()-]{0,18432}",key):
                if type(item) is not bool:raise ValueError('Invalid LUT view preferences.')
                continue
            valid=(type(item) is int and item in (1,2,3)) if key=='columns' else (
                item in ('all','favorite','recent','hidden') if key=='filter' else (
                type(item) is bool if key in ('hideLog','treeExpanded') else (
                type(item) in (int,float) and math.isfinite(item) and 0<=item<=1 if key=='strength' else (
                bool(re.fullmatch(r'mark:[a-f0-9]{64}',key)) and item in ('auto','log','normal')))))
            if not valid:raise ValueError('Invalid LUT view preferences.')
        return value


class CollageCanvasPreferences(StrictModel):
    width: int = Field(ge=100,le=12000)
    height: int = Field(ge=100,le=12000)
    gap: float = Field(ge=0,le=.08,allow_inf_nan=False)
    padding: float = Field(ge=0,le=.2,allow_inf_nan=False)
    radius: float = Field(ge=0,le=.2,allow_inf_nan=False)
    background: str = Field(pattern=r'^#[a-fA-F0-9]{6}$')
    edge_blend: float = Field(ge=0,le=10000,allow_inf_nan=False)

    @model_validator(mode='after')
    def area(self):
        if self.width*self.height>100000000:raise ValueError('Canvas area exceeds the limit.')
        return self


class CollagePreferences(ToolFields):
    canvas: CollageCanvasPreferences | None = None
    format: Literal['png','jpg','webp'] | None = None
    quality: int | None = Field(default=None,ge=1,le=100)
    showGuides: bool | None = None


class CollageBatchPreferences(ToolFields):
    size: Literal[2,3,4,6,9] | None = None
    order: Literal['selection','filename','capture_time'] | None = None
    remainder: Literal['own','merge','drop'] | None = None
    format: Literal['png','jpg','webp'] | None = None
    quality: int | None = Field(default=None,ge=1,le=100)


class CameraAlias(StrictModel):
    make: str = Field(max_length=200)
    model: str = Field(min_length=1,max_length=200)
    name: str = Field(min_length=1,max_length=80)

    @model_validator(mode='after')
    def valid_text(self):
        import re
        if not self.model.strip() or not self.name.strip() or any(re.search(r'[\x00-\x1f\x7f]',v) for v in (self.make,self.model,self.name)):
            raise ValueError('Invalid camera name mappings.')
        return self


class CameraNamePreferences(ToolFields):
    aliases: list[CameraAlias] | None = Field(default=None,max_length=500)

    @model_validator(mode='after')
    def unique_models(self):
        if self.aliases is not None:
            keys=[(' '.join(a.make.split()).lower(),' '.join(a.model.split()).lower()) for a in self.aliases]
            if len(set(keys))!=len(keys):raise ValueError('Duplicate camera name mapping.')
        return self


class LayerPreferences(ToolFields):
    textOpen: bool | None = None
    stickersOpen: bool | None = None
    visionOpen: bool | None = None
    modelsOpen: bool | None = None
    includeHidden: bool | None = None
    snap: bool | None = None


class AIStudioPreferences(ToolFields):
    mode: Literal['annotation','restyle','handwriting'] | None = None
    language: Literal['zh','en','both'] | None = None
    tagCount: int | None = Field(default=None,ge=1,le=30)
    captionLength: int | None = Field(default=None,ge=30,le=1500)
    ocr: bool | None = None
    placeGuess: bool | None = None
    missingOnly: bool | None = None


ToolName=Literal['aiStudio','layers','discover','cameraNames','viewer','compare','darkroom','split','lut','collage','collageBatch']
TOOL_SCHEMAS={'aiStudio':AIStudioPreferences,'layers':LayerPreferences,'discover':DiscoverPreferences,'cameraNames':CameraNamePreferences,'viewer':ViewerPreferences,'compare':ComparePreferences,'darkroom':DarkroomPreferences,'split':SplitPreferences,'lut':LutPreferences,'collage':CollagePreferences,'collageBatch':CollageBatchPreferences}


class ToolPatch(StrictModel):
    library_id: str = Field(min_length=1,max_length=80,pattern=r'^[a-zA-Z0-9-]+$')
    values: dict[str,object]


def gallery_values(row):
    return {key:value for key,value in (row.preferences or {}).items() if key in GalleryPreferences.model_fields}


class SettingsTransfer(StrictModel):
    accounts: list[TransferredProfile] | None = Field(default=None,max_length=20)
    library_id: str = Field(min_length=1,max_length=80,pattern=r'^[a-zA-Z0-9-]+$')
    gallery: GalleryPreferences | None = None
    tools: dict[str,dict] | None = None
    facets: FacetPreferences | None = None


@router.post('/settings-transfer')
def import_settings(payload:SettingsTransfer):
    values={}
    if payload.gallery is not None:values.update(payload.gallery.model_dump(exclude_unset=True))
    if payload.facets is not None:values['facets']=payload.facets.model_dump(exclude_unset=True)
    tools={}
    for kind,raw in (payload.tools or {}).items():
        if kind not in TOOL_SCHEMAS:raise ValueError('Invalid tool view preferences.')
        tools[kind]=TOOL_SCHEMAS[kind].model_validate(raw).model_dump(exclude_unset=True)
    # Explicit account bundles are imported as new profiles in the same transaction;
    # display preferences never accept recipe, path or credential fields.
    from .services import ai_studio
    with ai_studio.lock,Session() as session:
        session.execute(text('BEGIN IMMEDIATE'))
        row=session.get(LibraryProfile,1)
        if row.library_id!=payload.library_id:raise HTTPException(409,'Library changed. Reopen the current library.')
        previous=row.preferences or {};merged={**previous,**values}
        if 'facets' in values:merged['facets']={**previous.get('facets',{}),**values['facets']}
        merged['tools']={**previous.get('tools',{})}
        for kind,patch in tools.items():merged['tools'][kind]={**merged['tools'].get(kind,{}),**patch}
        pending=ai_studio.stage_import_profiles(session,payload.accounts or [])
        row.preferences=merged;session.commit()
        ai_studio._session_keys.update(pending)
        return {'ok':True}


class DocumentPreferences(StrictModel):
    zoom: Literal[1,1.5,2]

    @model_validator(mode='before')
    @classmethod
    def numeric_zoom(cls, value):
        if isinstance(value, dict) and type(value.get('zoom')) not in (int,float):
            raise ValueError('Invalid zoom.')
        return value


class DocumentPatch(StrictModel):
    library_id: str = Field(min_length=1, max_length=80, pattern=r'^[a-zA-Z0-9-]+$')
    values: DocumentPreferences


def profile(session, expected=None):
    row = session.get(LibraryProfile, 1)
    if row is None:
        raise HTTPException(503, '图库尚未就绪')
    if expected is not None and row.library_id != expected:
        raise HTTPException(409, '图库已切换，请重新打开当前图库')
    return row


@router.get('')
def workspace():
    from . import runtime_control
    with Session() as session:
        row = profile(session)
        return {'library_id':row.library_id, 'created_at':row.created_at, 'preferences':gallery_values(row),'tool_preferences':(row.preferences or {}).get('tools',{}),'album_preferences':(row.preferences or {}).get('albums',{}),'facet_preferences':(row.preferences or {}).get('facets',{}),'session_id':runtime_control.session_id}


@router.patch('/facets')
def update_facets(payload: FacetPatch):
    with Session() as session:
        session.execute(text('BEGIN IMMEDIATE'));row=profile(session,payload.library_id)
        preferences=row.preferences or {};values={**preferences.get('facets',{}),**payload.values.model_dump(exclude_unset=True)}
        row.preferences={**preferences,'facets':values};session.commit();return values


@router.patch('/albums')
def update_albums(payload: AlbumPatch):
    with Session() as session:
        session.execute(text('BEGIN IMMEDIATE'));row=profile(session,payload.library_id)
        preferences=row.preferences or {};values={**preferences.get('albums',{}),**payload.values.model_dump(exclude_unset=True)}
        row.preferences={**preferences,'albums':values};session.commit();return values


@router.patch('/preferences')
def update_gallery(payload: GalleryPatch):
    with Session() as session:
        # Serialize the read/merge/write so disjoint controls in two windows survive.
        session.execute(text('BEGIN IMMEDIATE'))
        row = profile(session, payload.library_id)
        row.preferences = (row.preferences or {}) | payload.values.model_dump(exclude_unset=True)
        session.commit()
        return gallery_values(row)


@router.patch('/tools/{tool}')
def update_tool(tool: ToolName,payload: ToolPatch):
    try:values=TOOL_SCHEMAS[tool].model_validate(payload.values).model_dump(exclude_unset=True)
    except ValidationError as error:raise HTTPException(422,'工具偏好无效') from error
    with Session() as session:
        session.execute(text('BEGIN IMMEDIATE'));row=profile(session,payload.library_id)
        preferences=row.preferences or {};tools=preferences.get('tools',{})
        current={**tools.get(tool,{}),**values}
        row.preferences={**preferences,'tools':{**tools,tool:current}}
        session.commit();return current


@router.get('/documents/{document_id}/view')
def document_view(document_id: str, library_id: str | None = None):
    with Session() as session:
        profile(session, library_id)
        if not session.get(EditDocument, document_id):
            raise HTTPException(404, '编辑记录不存在')
        row = session.get(DocumentViewPreference, document_id)
        return row.preferences if row else {}


@router.patch('/documents/{document_id}/view')
def update_document_view(document_id: str, payload: DocumentPatch):
    with Session() as session:
        session.execute(text('BEGIN IMMEDIATE'))
        profile(session, payload.library_id)
        if not session.get(EditDocument, document_id):
            raise HTTPException(404, '编辑记录不存在')
        row = session.get(DocumentViewPreference, document_id)
        if row is None:
            row = DocumentViewPreference(document_id=document_id, preferences={})
            session.add(row)
        row.preferences = payload.values.model_dump()
        session.commit()
        return row.preferences
