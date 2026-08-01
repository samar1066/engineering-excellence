from functools import lru_cache

from app.domain.workflows.notes_workflow import NotesWorkflow
from app.infrastructure.repositories.memory_note_repository import MemoryNoteRepository


@lru_cache
def get_notes_workflow() -> NotesWorkflow:
    return NotesWorkflow(repository=MemoryNoteRepository())
