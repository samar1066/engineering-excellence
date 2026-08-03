import os
from collections.abc import AsyncIterator
from typing import Any

import boto3
import pytest
import pytest_asyncio

from app.domain.entities.note import Note
from app.domain.interfaces.note_repository import NoteRepository
from app.infrastructure.repositories.memory_note_repository import MemoryNoteRepository
from dynamo_note_repository import DynamoNoteRepository

ENDPOINT = os.environ.get("DYNAMODB_ENDPOINT_URL")
TABLE_NAME = os.environ.get("NOTES_TABLE_NAME", "notes-contract")
REGION = os.environ.get("AWS_DEFAULT_REGION", "us-east-1")


def _admin_client() -> Any:
    return boto3.client(
        "dynamodb",
        endpoint_url=ENDPOINT,
        region_name=REGION,
        aws_access_key_id="local",
        aws_secret_access_key="local",
    )


@pytest.fixture(scope="session")
def dynamo_table() -> Any:
    # Skipping the store the interface actually ships is the antipattern EEP-ARCH-02 names, so with
    # no local endpoint the suite fails with an instruction rather than reporting a green run that
    # exercised only the reference.
    if not ENDPOINT:
        pytest.fail(
            "DYNAMODB_ENDPOINT_URL is not set; run scripts/contract-suite.sh to start DynamoDB Local"
        )
    client = _admin_client()
    client.create_table(
        TableName=TABLE_NAME,
        AttributeDefinitions=[{"AttributeName": "id", "AttributeType": "S"}],
        KeySchema=[{"AttributeName": "id", "KeyType": "HASH"}],
        BillingMode="PAY_PER_REQUEST",
    )
    client.get_waiter("table_exists").wait(TableName=TABLE_NAME)
    yield
    client.delete_table(TableName=TABLE_NAME)


def _clear_table() -> None:
    client = _admin_client()
    scanned = client.scan(TableName=TABLE_NAME)
    for item in scanned.get("Items", []):
        client.delete_item(TableName=TABLE_NAME, Key={"id": item["id"]})


@pytest_asyncio.fixture(params=["memory", "dynamo"])
async def repository(request: pytest.FixtureRequest) -> AsyncIterator[NoteRepository]:
    if request.param == "memory":
        yield MemoryNoteRepository()
        return
    # Only the dynamo column requires the local table, so the memory column runs with no container.
    request.getfixturevalue("dynamo_table")
    _clear_table()
    yield DynamoNoteRepository(table_name=TABLE_NAME, endpoint_url=ENDPOINT, region_name=REGION)


async def test_stores_a_note_and_reads_it_back(repository: NoteRepository) -> None:
    note = Note.create(note_id="n1", title="first", body="hello")
    added = await repository.add(note)
    assert added == note
    assert await repository.get("n1") == note


async def test_returns_none_for_an_unknown_id(repository: NoteRepository) -> None:
    assert await repository.get("missing") is None


async def test_lists_every_note_that_was_added(repository: NoteRepository) -> None:
    await repository.add(Note.create(note_id="a", title="alpha"))
    await repository.add(Note.create(note_id="b", title="beta"))
    ids = sorted(note.id for note in await repository.list_all())
    assert ids == ["a", "b"]


async def test_trims_a_title_before_it_is_stored(repository: NoteRepository) -> None:
    await repository.add(Note.create(note_id="t", title="  spaced  "))
    stored = await repository.get("t")
    assert stored is not None
    assert stored.title == "spaced"
