import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DomainValidationError, NotFoundError } from "../core/errors.js";
import { createNote, type Note } from "../domain/note.js";
import type { NoteRepository } from "../domain/note-repository.js";

/**
 * Orchestrates the notes use cases. Routes call these methods and nothing else reaches around
 * them to touch a repository. Library failures are translated into domain errors here, so the
 * layers above never have to know that zod produced them.
 */
export class NotesWorkflow {
  readonly #repository: NoteRepository;

  constructor(repository: NoteRepository) {
    this.#repository = repository;
  }

  async createNote(title: string, body = ""): Promise<Note> {
    let note: Note;
    try {
      note = createNote({ id: randomUUID().replaceAll("-", ""), title, body });
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new DomainValidationError(error.issues[0]?.message ?? "invalid note");
      }
      throw error;
    }
    return await this.#repository.add(note);
  }

  async getNote(id: string): Promise<Note> {
    const note = await this.#repository.get(id);
    if (note === null) throw new NotFoundError("note", id);
    return note;
  }

  async listNotes(): Promise<Note[]> {
    return await this.#repository.listAll();
  }
}
