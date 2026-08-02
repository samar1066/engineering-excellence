import type { Note } from "./note.js";

/**
 * The storage contract, expressed in entities. Implementations live in src/infrastructure and are
 * the only code that knows what storage sits below this interface.
 */
export interface NoteRepository {
  add(note: Note): Promise<Note>;
  get(id: string): Promise<Note | null>;
  listAll(): Promise<Note[]>;
}
