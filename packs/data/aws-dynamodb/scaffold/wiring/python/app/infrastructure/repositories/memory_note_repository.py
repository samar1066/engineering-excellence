from app.domain.entities.note import Note
from app.domain.interfaces.note_repository import NoteRepository


class MemoryNoteRepository(NoteRepository):
    """In memory implementation, copied from the python-fastapi backend.

    It is the column of the contract suite that always runs and the behavior the DynamoDB adapter
    must match exactly.
    """

    def __init__(self) -> None:
        self._notes: dict[str, Note] = {}

    async def add(self, note: Note) -> Note:
        self._notes[note.id] = note
        return note

    async def get(self, note_id: str) -> Note | None:
        return self._notes.get(note_id)

    async def list_all(self) -> list[Note]:
        return list(self._notes.values())
