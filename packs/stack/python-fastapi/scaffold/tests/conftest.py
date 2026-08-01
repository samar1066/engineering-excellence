import pytest
from httpx import ASGITransport, AsyncClient

from app.api.deps import get_notes_workflow
from app.main import create_app


@pytest.fixture
def app():
    get_notes_workflow.cache_clear()
    return create_app()


@pytest.fixture
async def client(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
