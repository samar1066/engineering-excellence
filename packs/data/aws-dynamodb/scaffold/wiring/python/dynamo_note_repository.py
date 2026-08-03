import os
from datetime import datetime
from typing import Any

import aioboto3

from app.domain.entities.note import Note
from app.domain.interfaces.note_repository import NoteRepository


class DynamoNoteRepository(NoteRepository):
    """DynamoDB implementation of the note repository.

    This file drops into the python-fastapi backend's app/infrastructure/repositories/ unchanged:
    it speaks the same Note entity and satisfies the same NoteRepository interface as the in memory
    reference, so replacing MemoryNoteRepository with it in app/api/deps.py is the whole
    substitution. The table name is read from the environment by default and the endpoint is
    overridable, so one adapter serves both a real regional table and a DynamoDB Local container.
    Every item read back is validated into a Note, so a malformed row fails loudly at this boundary
    rather than silently inside a workflow.
    """

    def __init__(
        self,
        table_name: str | None = None,
        endpoint_url: str | None = None,
        region_name: str | None = None,
    ) -> None:
        resolved = table_name or os.environ.get("NOTES_TABLE_NAME")
        if not resolved:
            raise RuntimeError("NOTES_TABLE_NAME is not set and no table_name was provided")
        self._table_name = resolved
        self._endpoint_url = endpoint_url or os.environ.get("DYNAMODB_ENDPOINT_URL")
        self._region_name = region_name or os.environ.get("AWS_DEFAULT_REGION")
        self._session = aioboto3.Session()

    def _resource(self) -> Any:
        return self._session.resource(
            "dynamodb",
            endpoint_url=self._endpoint_url,
            region_name=self._region_name,
        )

    async def add(self, note: Note) -> Note:
        async with self._resource() as dynamo:
            table = await dynamo.Table(self._table_name)
            await table.put_item(
                Item={
                    "id": note.id,
                    "title": note.title,
                    "body": note.body,
                    "created_at": note.created_at.isoformat(),
                }
            )
        return note

    async def get(self, note_id: str) -> Note | None:
        async with self._resource() as dynamo:
            table = await dynamo.Table(self._table_name)
            response = await table.get_item(Key={"id": note_id})
        item = response.get("Item")
        if item is None:
            return None
        return self._to_note(item)

    async def list_all(self) -> list[Note]:
        async with self._resource() as dynamo:
            table = await dynamo.Table(self._table_name)
            response = await table.scan()
        return [self._to_note(item) for item in response.get("Items", [])]

    @staticmethod
    def _to_note(item: dict[str, Any]) -> Note:
        return Note(
            id=str(item["id"]),
            title=str(item["title"]),
            body=str(item.get("body", "")),
            created_at=datetime.fromisoformat(str(item["created_at"])),
        )
