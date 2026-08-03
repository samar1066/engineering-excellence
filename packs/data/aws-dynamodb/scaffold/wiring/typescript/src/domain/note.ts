import { z } from "zod";

/**
 * The Note entity and its invariants. This is a faithful copy of the typescript-node backend's
 * src/domain/note.ts: the adapter beside it is a drop in for that backend, so it speaks the exact
 * same entity. A title is trimmed and must survive that trim with at least one character.
 */
export const noteSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1, "title must not be blank"),
  body: z.string(),
  createdAt: z.date(),
});

export type Note = z.infer<typeof noteSchema>;

export type NewNote = {
  id: string;
  title: string;
  body?: string | undefined;
};

/** Builds a Note, enforcing every invariant. Throws ZodError when an invariant fails. */
export function createNote(input: NewNote): Note {
  return noteSchema.parse({
    id: input.id,
    title: input.title,
    body: input.body ?? "",
    createdAt: new Date(),
  });
}
