---
title: EEP-OBS-01 binding
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-01
updated: 2026-08-01
---

## How this stack satisfies it

structlog is this stack's logging library, wired through a single
`configure_logging` entry point in app/core/logging.py that every process
calls once at startup, rather than each module reaching for its own setup.
That configuration emits structured JSON records and binds request scoped
context, most importantly a correlation identifier, so every log line written
while handling a request carries the identifier that ties it back to that
request. Because the setup lives in one module, changing the output shape or
adding a bound field means editing that module, not searching the codebase for
every place logging happens.

## The check

`file-contains app/core/logging.py configure_logging` (see
checks/manifest.yaml) is a builtin check that confirms app/core/logging.py
exists and defines a `configure_logging` symbol; it proves the entry point is
present, not that every call site uses it correctly. It is a fast check with
no dependencies, since it inspects source text rather than importing and
running the application.

## Notes for agents

If this check fails, the file or the function is either missing or misnamed;
add `configure_logging` to app/core/logging.py and call it once during
application startup, before the first request is handled. Do not scatter print
statements or a separate logging setup as a substitute; route all output
through the configured structlog logger so every line stays structured and
carries the bound context. If you add a new bound field, a user or tenant
identifier for example, bind it at the point the request context becomes
known, not deep inside business logic.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-01*
