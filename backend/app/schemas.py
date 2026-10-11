from typing import Literal
from pydantic import BaseModel, Field, field_validator, model_validator

class ImportRequest(BaseModel):
    paths: list[str] = Field(min_length=1, max_length=10000)
    recursive: bool = True

class PhotoUpdate(BaseModel):
    favorite: bool | None = None
    rating: int | None = Field(default=None, ge=0, le=5)
    color_label: str | None = Field(default=None, pattern='^(red|yellow|green|blue|none)$')
    tags: list[str] | None = Field(default=None, max_length=100)

class BatchEditRequest(BaseModel):
    photo_ids: list[str] = Field(min_length=1, max_length=10000)
    favorite: bool | None = None
    rating: int | None = Field(default=None, ge=0, le=5)
    color_label: str | None = Field(default=None, pattern='^(red|yellow|green|blue|none)$')
    add_tags: list[str] | None = Field(default=None, max_length=100)
    remove_tags: list[str] | None = Field(default=None, max_length=100)
    clear_rating: bool = False
    clear_color_label: bool = False

class FacePersonCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    @field_validator('name')
    @classmethod
    def nonblank(cls,value: str) -> str:
        if not value.strip():raise ValueError('人物名称不能为空')
        return value.strip()

class FacePersonRename(FacePersonCreate):
    pass

class FaceAnalysisRequest(BaseModel):
    photo_ids: list[str] = Field(default_factory=list,max_length=10000)
    threshold: float = Field(default=.45,ge=.3,le=.95)

class FaceAssignRequest(BaseModel):
    person_id: str | None = None

class SmartRequest(BaseModel):
    keywords: list[str] = Field(min_length=1, max_length=16)
    match_mode: Literal['all', 'any'] = 'any'
    threshold: float = Field(default=.38, ge=-1, le=1)
    max_results: int = Field(default=100, ge=1, le=10000)
    @field_validator('keywords')
    @classmethod
    def valid_keywords(cls, words: list[str]) -> list[str]:
        result = list(dict.fromkeys(word.strip()[:100] for word in words if word.strip()))
        if not result: raise ValueError('关键词不能为空')
        return result

class AlbumRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    person_id: str | None = Field(default=None, min_length=1, max_length=120)
    type: Literal['normal', 'smart'] = 'normal'
    keywords: list[str] = Field(default_factory=list, max_length=16)
    match_mode: Literal['all', 'any'] = 'any'
    threshold: float = Field(default=.38, ge=-1, le=1)
    max_results: int = Field(default=100, ge=1, le=10000)
    photo_ids: list[str] = Field(default_factory=list, max_length=10000)
    scores: dict[str, float] = Field(default_factory=dict)
    @field_validator('name')
    @classmethod
    def valid_name(cls, name: str) -> str:
        if not name.strip(): raise ValueError('影集名称不能为空')
        return name.strip()

class AlbumUpdate(BaseModel):
    cover_photo_id: str | None = None

class AlbumOrderRequest(BaseModel):
    photo_ids: list[str] = Field(default_factory=list, max_length=10000)

class PluginRunRequest(BaseModel):
    params: dict = Field(default_factory=dict)

class IdsRequest(BaseModel):
    ids: list[str] = Field(default_factory=list, max_length=1000)

class WatermarkOptions(BaseModel):
    template: Literal['frame', 'ambient'] = 'frame'
    style: Literal['modern_info_bar', 'classic_frame'] = 'modern_info_bar'
    show_brand_logo: bool = True
    info_bar_ratio: float = Field(default=.14, ge=.06, le=.25)
    font_scale: float = Field(default=1, ge=.5, le=2)
    fields: list[str] = Field(default_factory=lambda: ['camera_make','camera_model','focal_length','f_number','exposure_time','iso','date_taken'])
    signature: str = Field(default='', max_length=120)
    theme: Literal['white', 'black', 'auto'] = 'white'
    border: float = Field(default=.035, ge=.005, le=.2)
    info_height: float = Field(default=.16, ge=.04, le=.4)
    font_size: float = Field(default=1, ge=.5, le=2)
    align: Literal['left','center','right'] = 'center'
    radius: float = Field(default=.008, ge=0, le=.15)
    blur: float = Field(default=.08, ge=.005, le=.25)
    intensity: float = Field(default=.85, ge=0, le=1)
    brightness: float = Field(default=.7, ge=.1, le=2)
    saturation: float = Field(default=1.25, ge=0, le=3)
    photo_scale: float = Field(default=.88, ge=.5, le=.99)
    shadow: bool = True
    format: Literal['jpg','png'] = 'jpg'
    quality: int = Field(default=95, ge=1, le=100)
    long_edge: int = Field(default=4096, ge=0, le=16000)
    filename_template: str = Field(default='{original}_watermark', min_length=1, max_length=180)

    @model_validator(mode='before')
    @classmethod
    def existing_frame_settings(cls, value):
        if not isinstance(value, dict):
            return value
        value = value.copy()
        if 'fields' not in value and (value.get('template') == 'ambient' or value.get('style') == 'classic_frame'):
            value['fields'] = ['camera_make','camera_model','lens_model','focal_length','f_number','exposure_time','iso']
        if value.get('template', 'frame') == 'frame':
            if 'info_bar_ratio' not in value and 'info_height' in value:
                try:
                    height = float(value['info_height'])
                except (TypeError, ValueError):
                    raise ValueError('信息栏高度必须是数字')
                if not .04 <= height <= .4:
                    raise ValueError('信息栏高度超出允许范围')
                value['info_bar_ratio'] = max(.06, min(.25, height / (1 + height)))
            if 'font_scale' not in value and 'font_size' in value:
                value['font_scale'] = value['font_size']
        # Reuse fields as the single source of truth, accepting the spec's checkbox aliases.
        fields = value.get('fields', cls.model_fields['fields'].default_factory())
        if not isinstance(fields, list) or any(not isinstance(field, str) for field in fields):
            raise ValueError('fields 必须是字符串列表')
        fields = fields.copy()
        for alias, field in {'show_brand':'camera_make', 'show_model':'camera_model',
                'show_focal_length':'focal_length', 'show_aperture':'f_number',
                'show_shutter':'exposure_time', 'show_iso':'iso', 'show_date':'date_taken'}.items():
            if alias in value:
                enabled = value.pop(alias)
                if not isinstance(enabled, bool):
                    raise ValueError(f'{alias} 必须是布尔值')
                fields = [f for f in fields if f != field]
                if enabled:
                    fields.append(field)
        if 'fields' in value or fields != cls.model_fields['fields'].default_factory():
            value['fields'] = fields
        return value

class WatermarkRequest(BaseModel):
    photo_id: str
    options: WatermarkOptions = Field(default_factory=WatermarkOptions)

class BatchRequest(BaseModel):
    photo_ids: list[str] = Field(min_length=1, max_length=10000)
    options: WatermarkOptions = Field(default_factory=WatermarkOptions)

class StoragePathsRequest(BaseModel):
    data_dir: str = Field(min_length=1,max_length=4096)
    models_dir: str = Field(min_length=1,max_length=4096)
    exports_dir: str = Field(min_length=1,max_length=4096)
    scan_paths: list[str] = Field(default_factory=list,max_length=100)


class SettingsRequest(BaseModel):
    thumbnail_quality: int = Field(default=85, ge=30, le=100)
    count_mode: Literal['capture','file'] = 'capture'
    preview_preference: Literal['jpeg','raw'] = 'jpeg'
    export_format: Literal['jpg','png'] = 'jpg'
    export_quality: int = Field(default=95, ge=1, le=100)
    export_long_edge: int = Field(default=4096, ge=0, le=16000)
    focal_bands: list[float] = Field(default_factory=lambda:[24,35,60,100,200], min_length=5, max_length=5)
    @field_validator('focal_bands')
    @classmethod
    def ordered(cls, value: list[float]) -> list[float]:
        if value != sorted(set(value)) or value[0] <= 0: raise ValueError('焦段边界须严格递增且为正数')
        return value

