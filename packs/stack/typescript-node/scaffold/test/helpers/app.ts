import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach } from "vitest";
import { createApp } from "../../src/app.js";

/**
 * Builds a fresh application, and therefore a fresh in memory repository, around each test, then
 * closes it afterwards. Call it once at the top of an API test file and read the instance through
 * the returned accessor.
 */
export function useApp(): () => FastifyInstance {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = createApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  return () => app;
}
