"""Immutable source pixel semantics, separate from a v1 edit recipe."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator, field_validator


class SourceDecodeProfile(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    version: Literal[1, 2]
    extra_orientation: int = Field(ge=1, le=8)

    @field_validator('version', mode='before')
    @classmethod
    def integer_version(cls, value):
        if type(value) is not int:
            raise ValueError('Unsupported source decoding profile.')
        return value

    @model_validator(mode='after')
    def legacy_identity(self):
        if type(self.version) is not int or self.version == 1 and self.extra_orientation != 1:
            raise ValueError('Unsupported source decoding profile.')
        return self


LEGACY_SOURCE_DECODE = {'version': 1, 'extra_orientation': 1}
