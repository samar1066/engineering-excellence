from abc import ABC, abstractmethod

from app.domain.entities.note import Note


class NoteRepository(ABC):
    @abstractmethod
    async def add(self, note: Note) -> Note: ...

    @abstractmethod
    async def get(self, note_id: str) -> Note | None: ...

    @abstractmethod
    async def list_all(self) -> list[Note]: ...
