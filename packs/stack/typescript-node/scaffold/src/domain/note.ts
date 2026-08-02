import { z } from "zod";

/**
 * The Note entity and its invariants. The schema is the entity's own contract: a title is
 * trimmed and must survive that trim with at least one character, so a title of only spaces is
 * rejected here rather than reaching a repository.
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
