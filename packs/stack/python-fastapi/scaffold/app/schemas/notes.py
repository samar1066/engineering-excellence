from datetime import datetime

from pydantic import BaseModel, Field


class NoteCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    body: str = ""


class NoteResponse(BaseModel):
    id: str
    title: str
    body: str
    created_at: datetime
