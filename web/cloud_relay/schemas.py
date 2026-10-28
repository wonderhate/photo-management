"""Browser relay response schemas, independent of the desktop application."""
from pydantic import BaseModel, Field


class TitleSuggestion(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    evidence: str = Field(min_length=1, max_length=300)


class TitleSuggestions(BaseModel):
    suggestions: list[TitleSuggestion] = Field(min_length=1, max_length=3)
