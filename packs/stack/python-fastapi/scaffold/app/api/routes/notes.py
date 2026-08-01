from fastapi import APIRouter, Depends

from app.api.deps import get_notes_workflow
from app.domain.workflows.notes_workflow import NotesWorkflow
from app.schemas.notes import NoteCreateRequest, NoteResponse

router = APIRouter(prefix="/notes", tags=["notes"])


@router.post("", response_model=NoteResponse, status_code=201)
async def create_note(
    payload: NoteCreateRequest, workflow: NotesWorkflow = Depends(get_notes_workflow)
) -> NoteResponse:
    note = await workflow.create_note(title=payload.title, body=payload.body)
    return NoteResponse.model_validate(note.model_dump())


@router.get("", response_model=list[NoteResponse])
async def list_notes(workflow: NotesWorkflow = Depends(get_notes_workflow)) -> list[NoteResponse]:
    return [NoteResponse.model_validate(n.model_dump()) for n in await workflow.list_notes()]


@router.get("/{note_id}", response_model=NoteResponse)
async def get_note(
    note_id: str, workflow: NotesWorkflow = Depends(get_notes_workflow)
) -> NoteResponse:
    return NoteResponse.model_validate((await workflow.get_note(note_id)).model_dump())
