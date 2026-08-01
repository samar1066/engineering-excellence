---
title: EEP-OBS-02 binding
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-01
updated: 2026-08-01
---

## How this stack satisfies it

This stack initializes OpenTelemetry through a single `configure_tracing`
entry point in app/core/otel.py, using the vendor neutral SDK plus the FastAPI
instrumentation package, so every incoming request starts a span at the
framework boundary. Outbound calls made through the toolchain's instrumented
clients carry that trace context forward, so a request fanning out to a
database, a queue, or another service keeps one trace across the boundary
instead of starting a new, disconnected one on the other side. Initialization
happens once at startup, alongside logging configuration, so tracing is live
from the first request the process handles.

## The check

`file-contains app/core/otel.py configure_tracing` (see checks/manifest.yaml)
is a builtin check that confirms app/core/otel.py exists and defines
`configure_tracing`; like its EEP-OBS-01 counterpart, it proves the entry
point exists, not that every outbound call is instrumented. It is a static
text check, so it runs quickly without starting the application or a
collector.

## Notes for agents

If this check fails, add `configure_tracing` to app/core/otel.py and call it
during startup before the application begins serving requests. When you
introduce a new outbound call, an HTTP client, a queue producer, or a new
database driver, confirm it is one of the instrumented clients the toolchain
provides, or wrap it so the current span propagates into the call; an
uninstrumented client is how a trace quietly dies at a process boundary. Local
verification does not require a real tracing backend: a console exporter is
enough to see spans created and propagated before wiring a collector.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-01*
