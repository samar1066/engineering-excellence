import uuid

from pydantic import ValidationError

from app.core.exceptions import DomainValidationError, NotFoundError
from app.domain.entities.note import Note
from app.domain.interfaces.note_repository import NoteRepository


class NotesWorkflow:
    def __init__(self, repository: NoteRepository) -> None:
        self._repository = repository

    async def create_note(self, title: str, body: str = "") -> Note:
        try:
            note = Note.create(note_id=uuid.uuid4().hex, title=title, body=body)
        except ValidationError as exc:
            detail = exc.errors()[0]
            reason = detail.get("ctx", {}).get("error", detail["msg"])
            raise DomainValidationError(str(reason)) from exc
        return await self._repository.add(note)

    async def get_note(self, note_id: str) -> Note:
        note = await self._repository.get(note_id)
        if note is None:
            raise NotFoundError("note", note_id)
        return note

    async def list_notes(self) -> list[Note]:
        return await self._repository.list_all()
