import type { Note } from "./note.js";

/**
 * The storage contract, expressed in entities. A faithful copy of the typescript-node backend's
 * src/domain/note-repository.ts, so the DynamoDB adapter satisfies the exact interface the backend
 * already declares and every implementation behind it is judged by the one contract suite.
 */
export interface NoteRepository {
  add(note: Note): Promise<Note>;
  get(id: string): Promise<Note | null>;
  listAll(): Promise<Note[]>;
}
