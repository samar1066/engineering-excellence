import { type Note, noteSchema } from "../domain/note.js";
import type { NoteRepository } from "../domain/note-repository.js";

/**
 * In memory implementation. Replace it with a database repository when persistence arrives, and
 * keep the noteSchema.parse call: raw storage data becomes an entity at this boundary or not at
 * all, so a malformed row fails loudly here instead of quietly inside a workflow.
 */
export class MemoryNoteRepository implements NoteRepository {
  readonly #notes = new Map<string, Note>();

  add(note: Note): Promise<Note> {
    const stored = noteSchema.parse(note);
    this.#notes.set(stored.id, stored);
    return Promise.resolve(stored);
  }

  get(id: string): Promise<Note | null> {
    const found = this.#notes.get(id);
    return Promise.resolve(found === undefined ? null : noteSchema.parse(found));
  }

  listAll(): Promise<Note[]> {
    return Promise.resolve([...this.#notes.values()].map((note) => noteSchema.parse(note)));
  }
}
