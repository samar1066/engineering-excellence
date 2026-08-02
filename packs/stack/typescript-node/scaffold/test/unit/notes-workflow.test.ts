import { beforeEach, describe, expect, it } from "vitest";
import { DomainValidationError, NotFoundError } from "../../src/core/errors.js";
import { MemoryNoteRepository } from "../../src/infrastructure/memory-note-repository.js";
import { NotesWorkflow } from "../../src/workflows/notes-workflow.js";

describe("NotesWorkflow", () => {
  let workflow: NotesWorkflow;

  beforeEach(() => {
    workflow = new NotesWorkflow(new MemoryNoteRepository());
  });

  it("assigns an id when it creates a note", async () => {
    const note = await workflow.createNote("t");

    expect(note.id).toHaveLength(32);
    expect(note.title).toBe("t");
  });

  it("translates a blank title into a domain validation error", async () => {
    await expect(workflow.createNote("   ")).rejects.toBeInstanceOf(DomainValidationError);
  });

  it("raises not found for an id it never stored", async () => {
    await expect(workflow.getNote("nope")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("returns every note it stored", async () => {
    await workflow.createNote("a");
    await workflow.createNote("b");

    const titles = (await workflow.listNotes()).map((note) => note.title).sort();

    expect(titles).toEqual(["a", "b"]);
  });

  it("reads back a note it created", async () => {
    const created = await workflow.createNote("first", "hello");

    const fetched = await workflow.getNote(created.id);

    expect(fetched).toEqual(created);
  });
});
