import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

const healthResponse = z.object({ status: z.string() });

export const healthRoutes: FastifyPluginAsyncZod = (app) => {
  app.get("/health", { schema: { response: { 200: healthResponse } } }, () => ({ status: "ok" }));
  return Promise.resolve();
};
