"""Explicit cloud requests. No defaults authorize uploads or paid work."""
from typing import Literal
import re
from pydantic import BaseModel, ConfigDict, Field, SecretStr, model_validator


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, allow_inf_nan=False)


class Profile(Strict):
    name: str = Field(min_length=1, max_length=80)
    provider: Literal['qwen-cn', 'ark-cn']
    region: Literal['cn-beijing'] = 'cn-beijing'
    workspace: str = Field(default='', max_length=80, pattern=r'^[a-zA-Z0-9-]*$')
    image_model: str = Field(min_length=1, max_length=160, pattern=r'^[a-zA-Z0-9._-]+$')
    vision_model: str = Field(default='', max_length=160, pattern=r'^[a-zA-Z0-9._-]*$')
    revision: int = Field(default=0, ge=0)
    api_key: SecretStr | None = None
    clear_key: bool = False

    @model_validator(mode='after')
    def compatible(self):
        if not self.name.strip():raise ValueError('Enter an AI profile name.')
        if self.provider == 'qwen-cn':
            if self.image_model not in ('qwen-image-3.0','qwen-image-3.0-pro','qwen-image-edit-plus'):
                raise ValueError('Unsupported image model for this provider.')
            if self.vision_model and not self.vision_model.startswith('qwen'):
                raise ValueError('Unsupported vision model for this provider.')
        elif not re.fullmatch(r'(doubao-seedream-(4-0|4-5)-[0-9]+|ep-[a-zA-Z0-9-]+)',self.image_model):
            raise ValueError('Use a Seedream 4.0/4.5 model or your matching Ark endpoint ID.')
        if self.provider=='ark-cn' and (self.workspace or self.vision_model):
            raise ValueError('This Ark adapter supports image generation only.')
        if self.api_key and self.clear_key:raise ValueError('Choose save or remove key.')
        if self.api_key:
            key=self.api_key.get_secret_value()
            if not 10<=len(key)<=512 or any(c.isspace() for c in key):raise ValueError('Invalid API key')
        return self


class AnnotationOptions(Strict):
    language: Literal['zh','en','both'] = 'both'
    tag_count: int = Field(default=12, ge=1, le=30)
    caption_length: int = Field(default=300, ge=30, le=1500)
    ocr: bool = True
    place_guess: bool = False


class Scope(Strict):
    profile_id: str = Field(pattern=r'^[a-zA-Z0-9-]{1,80}$')
    photo_ids: list[str] = Field(default_factory=list, max_length=100)
    album_id: str | None = Field(default=None,pattern=r'^[a-zA-Z0-9-]{1,80}$')
    import_job_id: str | None = Field(default=None,pattern=r'^[a-zA-Z0-9-]{1,80}$')
    missing_only: bool = False
    options: AnnotationOptions = Field(default_factory=AnnotationOptions)

    @model_validator(mode='after')
    def one_scope(self):
        if sum((bool(self.photo_ids),bool(self.album_id),bool(self.import_job_id)))!=1:
            raise ValueError('Choose exactly one explicit photo scope.')
        if any(not re.fullmatch(r'[a-zA-Z0-9-]{1,80}',i) for i in self.photo_ids):raise ValueError('Invalid photo scope.')
        return self


class Authorize(Strict):
    token: str = Field(pattern=r'^[a-zA-Z0-9-]{1,80}$')
    count: int = Field(ge=1,le=100)
    confirmed: Literal[True]


class Create(Strict):
    profile_id: str = Field(pattern=r'^[a-zA-Z0-9-]{1,80}$')
    profile_revision: int = Field(ge=1)
    confirmed: Literal[True]
    kind: Literal['restyle','handwriting'] = 'restyle'
    photo_id: str | None = Field(default=None,pattern=r'^[a-zA-Z0-9-]{1,80}$')
    source_hash: str | None = Field(default=None,pattern=r'^[a-f0-9]{64}$')
    preset: str = Field(default='custom',pattern=r'^[a-z0-9-]{1,60}$')
    prompt: str = Field(default='',max_length=3000)
    text: str = Field(default='',max_length=120)
    parent_id: str | None = Field(default=None,pattern=r'^[a-zA-Z0-9-]{1,80}$')

    @model_validator(mode='after')
    def source(self):
        if self.kind=='restyle' and not self.photo_id:raise ValueError('Choose a source photo.')
        if bool(self.photo_id)!=bool(self.source_hash):raise ValueError('Source hash is required.')
        if self.kind=='handwriting' and not self.text.strip():raise ValueError('Enter the exact handwriting text.')
        return self


class HandwritingLayout(Strict):
    color: str = Field(default='#111111',pattern=r'^#[a-fA-F0-9]{6}$')
    x: float = Field(default=.5,ge=0,le=1)
    y: float = Field(default=.5,ge=0,le=1)
    scale: float = Field(default=.8,ge=.05,le=1)
    verified_text: Literal[True]


class AnnotationRepair(Strict):
    revision: int = Field(ge=1)
    result: dict


class PlaceReview(Strict):
    revision: int = Field(ge=1)
    status: Literal['accepted','rejected']


class StoredSource(Strict):
    id: str = Field(pattern=r'^[a-zA-Z0-9-]{1,80}$')
    name: str = Field(max_length=1024)
    hash: str = Field(pattern=r'^[a-f0-9]{64}$')
    revision: int | None = Field(default=None,ge=0)


class StoredPlaceReview(Strict):
    status: Literal['accepted','rejected']
    reviewed_at: str


class StoredResult(Strict):
    version: Literal[1]
    revision: int = Field(ge=1)
    source: StoredSource | None
    profile_id: str = Field(pattern=r'^[a-zA-Z0-9-]{1,80}$')
    provider: Literal['qwen-cn','ark-cn']
    model: str = Field(min_length=1,max_length=160)
    request_id: str = Field(max_length=200)
    options: AnnotationOptions | None = None
    result: dict | None = None
    repair_text: str | None = Field(default=None,max_length=64000)
    applied: bool | None = None
    place_review: StoredPlaceReview | None = None
    parent_id: str | None = Field(default=None,pattern=r'^[a-zA-Z0-9-]{1,80}$')
    prompt: str | None = Field(default=None,max_length=5000)
    preset: str | None = Field(default=None,max_length=60)
    text: str | None = Field(default=None,max_length=120)
    width: int | None = Field(default=None,ge=1,le=8192)
    height: int | None = Field(default=None,ge=1,le=8192)
    sha256: str | None = Field(default=None,pattern=r'^[a-f0-9]{64}$')
    verified_text: bool | None = None


def validate_stored_result(kind,record):
    from datetime import datetime
    from .services.ai_protocol import normalized_annotation
    r=StoredResult.model_validate(record)
    if r.place_review:datetime.fromisoformat(r.place_review.reviewed_at)
    if kind=='annotation':
        if r.options is None or r.source is None or r.source.revision is None or r.applied is None:
            raise ValueError('Invalid AI annotation history.')
        if r.result is not None:normalized_annotation(r.result,r.options.model_dump())
        if r.applied and r.result is None:raise ValueError('Invalid AI annotation history.')
        if r.place_review and not (r.result or {}).get('place_guess'):raise ValueError('Invalid AI place review.')
    elif kind in ('restyle','handwriting'):
        if not r.width or not r.height or r.width*r.height>40_000_000 or not r.sha256 or r.prompt is None or r.text is None:
            raise ValueError('Invalid AI image history.')
        if kind=='restyle' and r.source is None:raise ValueError('Missing AI image source.')
        if r.place_review:raise ValueError('Invalid AI place review.')
    else:raise ValueError('Invalid AI result kind.')
    return r


class ProfileExport(Strict):
    confirmed: Literal[True]
    profile_ids: list[str] = Field(min_length=1,max_length=20)


class TransferredProfileMetadata(Profile):
    id: str = Field(pattern=r'^[a-zA-Z0-9-]{1,80}$')


class TransferredProfile(Strict):
    profile: TransferredProfileMetadata
    api_key: SecretStr | None = None

    @model_validator(mode='after')
    def validate_key(self):
        if self.profile.api_key is not None or self.profile.clear_key:raise ValueError('Invalid settings profile.')
        if self.api_key:
            key=self.api_key.get_secret_value()
            if not 10<=len(key)<=512 or any(c.isspace() for c in key):raise ValueError('Invalid API key')
        return self
