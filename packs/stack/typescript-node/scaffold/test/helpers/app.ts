import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach } from "vitest";
import { createApp } from "../../src/app.js";
import { MemoryNoteRepository } from "../../src/infrastructure/memory-note-repository.js";

/**
 * Builds a fresh application around each test, wiring it to a fresh in memory repository so the API
 * tests stay independent of whichever repository the app is composed to run with, then closes it
 * afterwards. Call it once at the top of an API test file and read the instance through the returned
 * accessor.
 */
export function useApp(): () => FastifyInstance {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = createApp(new MemoryNoteRepository());
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  return () => app;
}
