import pytest

from app.core.exceptions import NotFoundError
from app.domain.workflows.notes_workflow import NotesWorkflow
from app.infrastructure.repositories.memory_note_repository import MemoryNoteRepository


@pytest.fixture
def workflow():
    return NotesWorkflow(repository=MemoryNoteRepository())


async def test_create_assigns_id(workflow):
    note = await workflow.create_note(title="t")
    assert len(note.id) == 32


async def test_get_missing_raises(workflow):
    with pytest.raises(NotFoundError):
        await workflow.get_note("nope")
