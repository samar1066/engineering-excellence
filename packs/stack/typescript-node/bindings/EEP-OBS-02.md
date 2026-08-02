---
title: EEP-OBS-02 binding
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-02
updated: 2026-08-02
---

## How this stack satisfies it

`configureTracing` in `src/core/otel.ts` starts the OpenTelemetry node SDK once
per process, with the service name attached as a resource attribute, and
registers `@fastify/otel` on the application so every route, and every fastify
lifecycle hook around it, produces spans under a defined root. Going through
the fastify plugin rather than a module patching loader is what makes this work
in a native ESM service without a start up flag, and it keeps the wiring
visible in `createApp` instead of hidden in an environment variable. The
context those spans run in is the standard OpenTelemetry one, so an outbound
call made with an instrumented client continues the same trace rather than
starting a second one. Under vitest the provider is given no span processor:
spans are recorded and dropped, because a console exporter would interleave
span dumps with the test report and flush again after the run has finished.

## The check

`file-contains src/core/otel.ts configureTracing` (see checks/manifest.yaml) is
a builtin check confirming the tracing setup module exists and still exposes
the entry point `createApp` calls, which proves initialization is wired rather
than that a span reached a backend. It is a fast static check, and it is
deliberately paired with the rule that the function is called exactly once, at
application construction, where a reviewer can see it.

## Notes for agents

Initialize tracing only through `configureTracing`, and never add a second
tracer provider: OpenTelemetry refuses to replace a provider that is already
global, so the second one silently does nothing. When you add an outbound call,
use an instrumented client or propagate the current context explicitly, because
a hand rolled request that drops the context turns every hop beyond it into a
disconnected trace. To see spans locally, run the service outside vitest with
`make run`, where the console exporter is active.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
