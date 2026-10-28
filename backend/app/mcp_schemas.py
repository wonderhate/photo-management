"""Bounded MCP arguments. No URLs, executable code, SQL or credentials."""
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
from .schemas import PhotoUpdate
from .ai_schemas import AnnotationOptions

ID=Annotated[str,Field(pattern=r'^[a-zA-Z0-9_-]{1,80}$')]
IDs=Annotated[list[ID],Field(min_length=1,max_length=100)]

class Strict(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True,allow_inf_nan=False)

class Empty(Strict):pass
class Catalog(Strict):catalog_id:ID
class Selection(Catalog):
    photo_ids:IDs|None=None
    selection_version:int|None=Field(default=None,ge=1)
    @model_validator(mode='after')
    def one(self):
        if (self.photo_ids is None)==(self.selection_version is None):raise ValueError('Choose explicit photo IDs or a selection version.')
        if self.photo_ids and len(set(self.photo_ids))!=len(self.photo_ids):raise ValueError('Duplicate photo IDs.')
        return self
class Asset(Catalog):photo_id:ID
class Page(Catalog):
    page:int=Field(default=1,ge=1,le=100000)
    page_size:int=Field(default=24,ge=1,le=100)
class Search(Page):
    query:dict|None=None
    text:str=Field(default='',max_length=256)
    count_mode:Literal['capture','file']='capture'
    @model_validator(mode='after')
    def ast(self):
        if self.query is not None:
            from .services.photo_query import normalize
            self.query=normalize(self.query)
        return self
class Tags(Page):q:str=Field(default='',max_length=120)
class Bounds(Strict):
    west:float=Field(ge=-180,le=180)
    east:float=Field(ge=-180,le=180)
    south:float=Field(ge=-90,le=90)
    north:float=Field(ge=-90,le=90)
class Map(Catalog):viewport:Bounds|None=None
class Show(Selection):view:Literal['photos']='photos'
class View(Selection):edge:Literal[256,512]=256
class Job(Catalog):job_id:ID
class Patch(PhotoUpdate):model_config=ConfigDict(extra='forbid',strict=True,allow_inf_nan=False)
class Update(Selection):patch:Patch
class Delete(Selection):scope:Literal['file','capture']='file'
class Location(Asset):
    source_hash:str=Field(pattern=r'^[a-f0-9]{64}$')
    expected_revision:int=Field(ge=0)
    operation:Literal['set','clear','undo']
    value:dict|None=None
    @model_validator(mode='after')
    def location(self):
        from .services.photo_location import manual
        if self.operation=='set':self.value=manual(self.value)
        elif self.value is not None:raise ValueError('Only set accepts a location.')
        return self
class Annotate(Selection):
    profile_id:ID
    profile_revision:int=Field(ge=1)
    options:AnnotationOptions=Field(default_factory=AnnotationOptions)
class Repaint(Asset):
    profile_id:ID
    profile_revision:int=Field(ge=1)
    source_hash:str=Field(pattern=r'^[a-f0-9]{64}$')
    preset:str=Field(default='custom',pattern=r'^[a-z0-9-]{1,60}$')
    prompt:str=Field(default='',max_length=3000)
class Crop(Selection):
    x:float=Field(ge=0,lt=1)
    y:float=Field(ge=0,lt=1)
    width:float=Field(gt=0,le=1)
    height:float=Field(gt=0,le=1)
    @model_validator(mode='after')
    def bounds(self):
        if self.x+self.width>1 or self.y+self.height>1:raise ValueError('Crop exceeds image bounds.')
        return self
class Export(Selection):
    format:Literal['jpg','png','webp']='jpg'
    quality:int=Field(default=90,ge=1,le=100)
    long_edge:int=Field(default=4096,ge=0,le=16000)
class Text(Selection):
    text:str=Field(min_length=1,max_length=4000)
    x:float=Field(default=.5,ge=-4,le=5)
    y:float=Field(default=.5,ge=-4,le=5)
    size:int=Field(default=80,ge=1,le=1000)
    color:str=Field(default='#ffffff',pattern=r'^#[a-fA-F0-9]{6}$')
class Edit(Selection):
    recipe:dict
    @model_validator(mode='after')
    def recipe_valid(self):
        from .editor_schemas import recipe_adapter
        self.recipe=recipe_adapter.validate_python(self.recipe).model_dump()
        return self
class Frame(Selection):
    template:Literal['frame','ambient']='frame'
class Collection(Catalog):
    action:Literal['list','get','create','rename','add','remove','delete']
    collection_id:ID|None=None
    name:str=Field(default='',max_length=120)
    photo_ids:list[ID]=Field(default_factory=list,max_length=100)
    @model_validator(mode='after')
    def required(self):
        if self.action not in ('list','create') and not self.collection_id:raise ValueError('Collection ID required.')
        if self.action in ('create','rename') and not self.name.strip():raise ValueError('Collection name required.')
        if self.action in ('add','remove') and not self.photo_ids:raise ValueError('Photo IDs required.')
        return self
class Import(Catalog):
    path:str=Field(min_length=1,max_length=32768)
    recursive:bool=True
class Maintain(Catalog):
    action:Literal['verify_assets','refresh_from_disk','scan_new_media','list_watched_dirs','add_watched_dir','remove_watched_dir','relink']
    path:str|None=Field(default=None,max_length=32768)
    photo_id:ID|None=None
    photo_ids:IDs|None=None
    @model_validator(mode='after')
    def required(self):
        if self.action in ('add_watched_dir','remove_watched_dir','relink') and not self.path:raise ValueError('Path required.')
        if self.action=='relink' and not self.photo_id:raise ValueError('Photo ID required.')
        if self.action in ('verify_assets','refresh_from_disk') and not self.photo_ids:raise ValueError('Choose up to 100 explicit photo IDs.')
        return self
class Raw(Asset):
    action:Literal['list_pending','confirm_match']
    value:dict|None=None
    page:int=Field(default=1,ge=1)
    @model_validator(mode='after')
    def confirmation(self):
        if self.action=='confirm_match':
            from .services.raw_source_contract import confirmation
            self.value=confirmation(self.value)
        elif self.value is not None:raise ValueError('Only confirm_match accepts a confirmation.')
        return self
class Person(Catalog):person_id:ID
class PersonUpdate(Person):name:str=Field(min_length=1,max_length=120)
class Faces(Selection):threshold:float=Field(default=.45,ge=.3,le=.95)
class Similar(Asset):
    mode:Literal['appearance','semantic']='appearance'
    distance:int=Field(default=6,ge=0,le=16)
    limit:int=Field(default=24,ge=1,le=100)
class Lookalikes(Catalog):
    after:str=Field(default='',max_length=80)
    distance:int=Field(default=6,ge=0,le=16)
    limit:int=Field(default=12,ge=1,le=20)
class Collage(Catalog):
    project_id:ID
    revision:int=Field(ge=1)
    format:Literal['png','jpg']='png'
    quality:int=Field(default=90,ge=1,le=100)
    long_edge:int=Field(default=4096,ge=256,le=16000)

# Every family is implemented in mcp_tools; mutation classification is refined
# for multi-action families before admission and checked again on approval.
TOOLS={
 'get_catalog_info':(Empty,'read','Current catalog identity and bounded counts.'),
 'search_assets':(Search,'read','Search metadata with a validated query AST and bounded pages.'),
 'get_asset':(Asset,'read','Read photo metadata, never original file bytes.'),
 'view_assets':(View,'read','View at most four metadata-free, bounded local previews.'),
 'list_tags':(Tags,'read','Page through tags.'),
 'browse_map':(Map,'read','Read bounded location clusters.'),
 'show_in_app':(Show,'write','Reveal explicit photos in the app after approval.'),
 'get_selection':(Catalog,'read','Read the active app selection and its version; expires after 15 seconds.'),
 'annotate_assets':(Annotate,'paid','Request domestic AI captions/tags/OCR; requires app upload and billing consent.'),
 'get_job_status':(Job,'read','Read a task and its result.'),
 'list_active_jobs':(Catalog,'read','List bounded task summaries.'),
 'cancel_job':(Job,'write','Cancel pending work. Submitted cloud requests may still be billed.'),
 'pause_job':(Job,'write','Pause an unclaimed Agent approval or app task. Running work cannot be paused.'),
 'resume_job':(Job,'write','Resume a paused, unclaimed Agent task; never retry paid work.'),
 'update_assets':(Update,'write','Update library metadata; original files stay read-only.'),
 'crop_assets':(Crop,'write','Save new non-destructive crop documents using the app editor.'),
 'export_assets':(Export,'write','Render new exports to the configured output location.'),
 'repaint_asset':(Repaint,'paid','Request a single Qwen/Ark restyle with explicit app approval; no automatic retry.'),
 'delete_assets':(Delete,'write','Soft-remove library records; never delete originals.'),
 'set_asset_location':(Location,'write','Set, clear or undo a versioned catalog location.'),
 'add_text':(Text,'write','Save new editor documents with a text layer.'),
 'generate_previews':(Selection,'write','Rebuild derived previews from read-only originals.'),
 'manage_collections':(Collection,'write','List/read/create/rename/change/remove collections.'),
 'import_directory':(Import,'write','Import an explicitly approved local directory, without moving originals.'),
 'maintain_library':(Maintain,'write','Verify/relink sources, refresh metadata, scan or manage watched directories.'),
 'raw_pairing':(Raw,'write','Read RAW candidates or confirm a versioned manual pairing.'),
 'list_people':(Page,'read','Page local people groups.'),
 'get_person':(Person,'read','Read a person and up to 40 matching photos.'),
 'update_person':(PersonUpdate,'write','Rename a local person group.'),
 'index_people':(Faces,'write','Analyze explicitly selected photos with installed local face models.'),
 'find_similar':(Similar,'read','Find bounded appearance or local semantic matches.'),
 'list_lookalikes':(Lookalikes,'read','Page near-duplicate groups.'),
 'index_lookalikes':(Catalog,'write','Build local visual fingerprints.'),
 'get_editor_capabilities':(Catalog,'read','Discover exact editor schema and local capabilities.'),
 'render_collage':(Collage,'write','Render an existing, version-pinned collage with the app renderer.'),
 'edit_asset':(Edit,'write','Save new documents using a validated editing recipe; no executable code.'),
 'apply_frame':(Frame,'write','Create watermark drafts using a built-in frame preset.'),
}

def permission(name,args):
    if name=='manage_collections' and args['action'] in ('list','get'):return 'read'
    if name=='maintain_library' and args['action']=='list_watched_dirs':return 'read'
    if name=='raw_pairing' and args['action']=='list_pending':return 'read'
    return TOOLS[name][1]

def parse(name,value):
    if name not in TOOLS:raise ValueError('Unknown MCP tool.')
    parsed=TOOLS[name][0].model_validate(value)
    result=parsed.model_dump(exclude_none=True)
    if name=='update_assets':result['patch']=parsed.patch.model_dump(exclude_unset=True)
    return result

def catalog():
    return [dict(name=name,description=description,inputSchema=model.model_json_schema(),annotations={
        'readOnlyHint':scope=='read','destructiveHint':name in ('delete_assets','manage_collections'),
        'openWorldHint':scope=='paid','idempotentHint':scope=='read'}) for name,(model,scope,description) in TOOLS.items()]
