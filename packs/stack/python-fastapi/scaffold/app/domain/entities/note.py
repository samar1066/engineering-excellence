from datetime import UTC, datetime

from pydantic import BaseModel, field_validator


class Note(BaseModel):
    id: str
    title: str
    body: str = ""
    created_at: datetime

    @field_validator("title")
    @classmethod
    def title_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("title must not be blank")
        return v.strip()

    @classmethod
    def create(cls, note_id: str, title: str, body: str = "") -> "Note":
        return cls(id=note_id, title=title, body=body, created_at=datetime.now(UTC))
