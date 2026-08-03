import pytest
from httpx import ASGITransport, AsyncClient

from app.api.deps import get_notes_workflow
from app.domain.workflows.notes_workflow import NotesWorkflow
from app.infrastructure.repositories.memory_note_repository import MemoryNoteRepository
from app.main import create_app


@pytest.fixture
def app():
    # API tests exercise the routes and the workflow against a fresh in-memory repository per test,
    # overriding whichever repository the app is wired to run with. This keeps them fast and
    # deterministic and green in any composition, standalone or with a data pack swapped in behind
    # the interface. The repository implementations are proven interchangeable by the repository
    # contract suite (EEP-ARCH-02), not by driving a real data store through the HTTP layer.
    application = create_app()
    workflow = NotesWorkflow(repository=MemoryNoteRepository())
    application.dependency_overrides[get_notes_workflow] = lambda: workflow
    return application


@pytest.fixture
async def client(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
