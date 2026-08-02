---
title: EEP-OBS-01 binding
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-02
updated: 2026-08-02
---

## How this stack satisfies it

`configureLogging` in `src/core/logging.ts` builds one pino logger for the
process, and `createApp` hands that instance to fastify, so every request
logger is a child of it and emits the same JSON shape. The identifier rides in
an `AsyncLocalStorage` store rather than through function signatures: an
`onRequest` hook reads `x-correlation-id` from the caller, or mints one when it
is absent, echoes it on the response, and runs the rest of the request inside
`runWithCorrelationId`. A pino mixin reads that store on every line, so
`correlation_id` appears on each event logged while the request is in flight
without a single call site passing it along. `runWithCorrelationId` is exported
for the same reason: work that leaves the request path, a queued message or a
background task, binds the identifier it was given instead of starting a new
one.

## The check

`file-contains src/core/logging.ts configureLogging` (see
checks/manifest.yaml) is a builtin check confirming the setup module exists and
still exposes the entry point the application calls; it proves the wiring is
present, not that a particular line was emitted at runtime. The behavior itself
is proved by the suite: `test/unit/logging.test.ts` captures the emitted JSON
and asserts the identifier is stamped inside the bound context and absent
outside it.

## Notes for agents

Log through the injected logger, `request.log` inside a handler or the instance
returned by `configureLogging` at startup, and pass context as fields rather
than formatting it into the message text, since a field is queryable and a
sentence is not. Never call `configureLogging` a second time: the process has
one logging pipeline, and a second one produces two shapes in the same stream.
When you hand work to a background task, wrap it in `runWithCorrelationId` with
the current identifier instead of generating a fresh one, which would break the
request's trail at exactly the boundary that matters.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
