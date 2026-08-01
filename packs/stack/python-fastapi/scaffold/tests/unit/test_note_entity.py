import pytest

from app.domain.entities.note import Note


def test_create_strips_and_stamps():
    note = Note.create("id1", "  padded  ")
    assert note.title == "padded"
    assert note.created_at is not None


def test_blank_title_rejected():
    with pytest.raises(ValueError):
        Note.create("id1", "   ")
