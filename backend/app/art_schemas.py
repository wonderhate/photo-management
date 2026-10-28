from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator


class ArtLayout(BaseModel):
    model_config = ConfigDict(extra='forbid')
    title: str = Field(default='', max_length=80)
    title_source: Literal['manual', 'suggested', 'none'] = 'manual'
    title_evidence: str = Field(default='', max_length=300)
    layout: Literal['airy', 'reference'] = 'airy'
    font: Literal['chinese_handwriting', 'chinese_brush', 'chinese_running', 'chinese_cursive', 'fine', 'brush', 'calligraphy', 'text'] = 'chinese_handwriting'
    paper: float = Field(default=.35, ge=0, le=1)

    @field_validator('title')
    @classmethod
    def one_line(cls, value):
        if any(ord(c) < 32 for c in value):
            raise ValueError('Title must be a single line')
        return value.strip()


class CloudAuthorization(BaseModel):
    model_config = ConfigDict(extra='forbid')
    cloud_confirmed: bool = Field(strict=True)

    @field_validator('cloud_confirmed')
    @classmethod
    def explicit_cloud_confirmation(cls, value):
        if value is not True:
            raise ValueError('Confirm the cloud upload and possible charge before submitting.')
        return value


class ArtGenerate(CloudAuthorization):
    model_config = ConfigDict(extra='forbid')
    photo_id: str = Field(min_length=1, max_length=64)
    layout: ArtLayout = Field(default_factory=ArtLayout)
    title_confirmed: Literal[True]
    quality: Literal['low', 'medium', 'high'] = 'medium'
    description: str = Field(default='', max_length=1500)


class ArtTitleRequest(CloudAuthorization):
    photo_id: str = Field(min_length=1, max_length=64)
    keywords: str = Field(default='', max_length=200)
    language: Literal['zh', 'en'] = 'zh'


class ArtBatchGenerate(CloudAuthorization):
    model_config = ConfigDict(extra='forbid')
    photo_ids: list[Annotated[str, Field(min_length=1, max_length=64)]] = Field(min_length=1, max_length=100)
    layout: ArtLayout = Field(default_factory=ArtLayout)
    quality: Literal['low', 'medium', 'high'] = 'medium'
    description: str = Field(default='', max_length=1500)
    generate_titles: bool = False
    keywords: str = Field(default='', max_length=200)
    language: Literal['zh', 'en'] = 'zh'

    @field_validator('photo_ids')
    @classmethod
    def unique_photos(cls, value):
        return list(dict.fromkeys(value))


class TitleSuggestion(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    evidence: str = Field(min_length=1, max_length=300)


class TitleSuggestions(BaseModel):
    suggestions: list[TitleSuggestion] = Field(min_length=1, max_length=3)


class ArtUpdate(BaseModel):
    revision: int = Field(ge=1)
    layout: ArtLayout


class ArtSettings(BaseModel):
    model_config = ConfigDict(extra='forbid')
    image_model: str = Field(default='qwen-image-3.0', pattern=r'^qwen-image-3\.0(?:-pro)?$', max_length=100)
    title_model: str = Field(default='qwen3-vl-plus', pattern=r'^qwen[\w.-]+$', max_length=100)
    api_key: SecretStr | None = None
    clear_key: bool = False


class ArtExport(BaseModel):
    format: Literal['jpg', 'png'] = 'png'
