---
title: EEP-TEST-03 binding
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-01
updated: 2026-08-01
---

## How this stack satisfies it

pytest measures branch coverage over `app/` and the build fails under 85
percent. API tests exercise every route through the httpx ASGI transport, so
the public surface is the covered surface.

## The check

`uv run pytest --cov=app --cov-fail-under=85 -q` (see checks/manifest.yaml).

## Notes for agents

Add the failing test in the same change as the behavior. When coverage drops
on a diff, the missing test belongs to the code you just wrote.
---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-01*
