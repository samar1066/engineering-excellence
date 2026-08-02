import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { type DestinationStream, type Logger, pino } from "pino";

/** Header the correlation id is read from and echoed back on, so a caller can quote it back. */
export const CORRELATION_HEADER = "x-correlation-id";

type RequestContext = { correlationId: string };

const requestContext = new AsyncLocalStorage<RequestContext>();

/** The correlation id bound to the unit of work currently running, when there is one. */
export function currentCorrelationId(): string | undefined {
  return requestContext.getStore()?.correlationId;
}

/**
 * Runs `work` with `correlationId` bound to it. HTTP requests reach this through the hook below;
 * call it directly when work leaves the request path, for a background task or a queue consumer,
 * so the identifier keeps binding instead of restarting at the next boundary.
 */
export function runWithCorrelationId<T>(correlationId: string, work: () => T): T {
  return requestContext.run({ correlationId }, work);
}

/**
 * Builds the one structured logger for this process. Call it once, at startup, and pass the
 * result to fastify so every request logger inherits the same JSON pipeline and the same mixin.
 * The destination is a seam for tests, which capture lines instead of writing to standard output.
 */
export function configureLogging(level: string, destination?: DestinationStream): Logger {
  const options = {
    level,
    mixin() {
      const correlationId = currentCorrelationId();
      return correlationId === undefined ? {} : { correlation_id: correlationId };
    },
  };
  return destination === undefined ? pino(options) : pino(options, destination);
}

/**
 * Binds a correlation id to AsyncLocalStorage for the whole request, so every log line emitted
 * while handling it carries the id without threading it through a single function signature. An
 * inbound id is reused rather than replaced, which is what keeps one caller's trail intact across
 * services; only a request that arrives without one gets a fresh id.
 */
export function installCorrelationId(app: FastifyInstance): void {
  app.addHook("onRequest", (request, reply, done) => {
    const inbound = request.headers[CORRELATION_HEADER];
    const correlationId = typeof inbound === "string" && inbound !== "" ? inbound : randomUUID();
    reply.header(CORRELATION_HEADER, correlationId);
    runWithCorrelationId(correlationId, done);
  });
}
