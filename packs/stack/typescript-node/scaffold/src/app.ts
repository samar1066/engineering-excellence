import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { settings } from "./core/config.js";
import { DomainValidationError, NotFoundError } from "./core/errors.js";
import { configureLogging, installCorrelationId } from "./core/logging.js";
import { configureTracing } from "./core/otel.js";
import type { NoteRepository } from "./domain/note-repository.js";
import { MemoryNoteRepository } from "./infrastructure/memory-note-repository.js";
import { healthRoutes } from "./routes/health.js";
import { notesRoutes } from "./routes/notes.js";
import { NotesWorkflow } from "./workflows/notes-workflow.js";

/**
 * The composition root: the one place that knows both a concrete repository and a route exist.
 * Routes receive their workflow through plugin options, which is what keeps src/routes free of any
 * import from src/infrastructure. The repository is a parameter defaulting to the one this app is
 * wired to run with, so a test can pass a fresh in-memory repository and a composed data pack can
 * swap the default behind the interface without any route or workflow changing.
 */
export function createApp(
  repository: NoteRepository = new MemoryNoteRepository(),
): FastifyInstance {
  // Held at fastify's own logger type rather than pino's: the concrete pino type would leak into
  // every FastifyInstance signature in the codebase, and the point of configureLogging is that
  // nothing downstream has to name the logging library.
  const logger: FastifyBaseLogger = configureLogging(settings.logLevel);
  const app = Fastify({ loggerInstance: logger }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  configureTracing(app, settings.serviceName);
  installCorrelationId(app);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof NotFoundError) {
      return reply.code(404).send({ detail: error.message });
    }
    if (error instanceof DomainValidationError) {
      return reply.code(422).send({ detail: error.message });
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.code(422).send({ detail: "request validation failed" });
    }
    request.log.error({ err: error }, "unhandled error");
    return reply.code(500).send({ detail: "internal server error" });
  });

  const workflow = new NotesWorkflow(repository);
  app.register(healthRoutes);
  app.register(notesRoutes, { workflow });
  return app;
}
