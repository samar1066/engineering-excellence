import { type Note, noteSchema } from "../domain/note.js";
import type { NoteRepository } from "../domain/note-repository.js";

/**
 * The in memory reference implementation, copied from the typescript-node backend. It is the column
 * of the contract suite that always runs, and the behavior the DynamoDB adapter must match exactly.
 * The noteSchema.parse call is the boundary where raw storage data becomes an entity or not at all.
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
