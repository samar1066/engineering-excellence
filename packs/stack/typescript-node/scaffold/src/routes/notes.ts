import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Note } from "../domain/note.js";
import type { NotesWorkflow } from "../workflows/notes-workflow.js";

// The wire contract, owned by this layer. It is deliberately not the entity: the request schema
// only rejects what the transport can decide (a title must be a present, non empty string), while
// the domain rule that a title cannot be whitespace lives on the entity, and the response speaks
// an ISO timestamp where the entity holds a Date.
const createNoteBody = z.object({ title: z.string().min(1), body: z.string().optional() });
const noteParams = z.object({ id: z.string().min(1) });
const noteResponse = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  createdAt: z.string(),
});
const noteListResponse = z.array(noteResponse);

export type NotesRoutesOptions = { workflow: NotesWorkflow };

function toResponse(note: Note): z.infer<typeof noteResponse> {
  return {
    id: note.id,
    title: note.title,
    body: note.body,
    createdAt: note.createdAt.toISOString(),
  };
}

export const notesRoutes: FastifyPluginAsyncZod<NotesRoutesOptions> = (app, options) => {
  const { workflow } = options;

  app.post(
    "/notes",
    { schema: { body: createNoteBody, response: { 201: noteResponse } } },
    async (request, reply) => {
      const note = await workflow.createNote(request.body.title, request.body.body ?? "");
      return reply.code(201).send(toResponse(note));
    },
  );

  app.get("/notes", { schema: { response: { 200: noteListResponse } } }, async () => {
    const notes = await workflow.listNotes();
    return notes.map(toResponse);
  });

  app.get(
    "/notes/:id",
    { schema: { params: noteParams, response: { 200: noteResponse } } },
    async (request) => toResponse(await workflow.getNote(request.params.id)),
  );

  return Promise.resolve();
};
