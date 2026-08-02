---
title: python-fastapi
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-01
updated: 2026-08-01
---

# python-fastapi

A Tier 1 stack pack that binds the Engineering Excellence Program, program version 0.1.0, to Python 3.11 services built on FastAPI. A repository matches this pack when its `pyproject.toml` contains `fastapi`. The pack turns the program's laws into concrete practice for this stack: a golden path document, a runnable scaffold with a worked example feature, blessed tool configurations, and executable checks that prove each law it implements.

## What this pack gives you

- `STACK.md`: the golden path an AI coding agent reads before writing any code in a FastAPI service.
- A runnable five layer scaffold under `scaffold/` with a complete notes feature: route, schemas, workflow, entity, repository interface, in memory implementation, and tests at every level.
- Blessed configuration templates under `templates/config/` for ruff, mypy, import-linter, pytest, structlog, OpenTelemetry, and pre-commit.
- Executable checks in `checks/manifest.yaml` that map each implemented law to the command proving it.
- One command entry points in the scaffold `Makefile`: `make setup`, `make test`, `make verify`, `make run`.

## Laws implemented

This pack implements twelve laws:

- EEP-ARCH-01
- EEP-TEST-01
- EEP-TEST-03
- EEP-SEC-01
- EEP-SEC-02
- EEP-OBS-01
- EEP-OBS-02
- EEP-DLV-01
- EEP-DLV-02
- EEP-DOCS-01
- EEP-DOCS-02
- EEP-DEVX-01

The how and the why for each law in this stack live in `bindings/<LAW-ID>.md`, one file per law above.

It declines one law: EEP-DOCS-03, with the recorded reason "Corpus scoped law; consumer repositories are not required to index every directory."

## Blessed toolchain

| Tool | Config | Rationale |
|------|--------|-----------|
| uv | | Fast resolver with a lockfile by default. |
| ruff format | templates/config/ruff.toml | One tool with the linter, zero config drift. |
| ruff | templates/config/ruff.toml | Replaces Black, isort, Flake8, and bandit rules in one pass. |
| mypy --strict | templates/config/mypy.ini | Strict from day one is cheaper than strict later. |
| import-linter | templates/config/importlinter.toml | Enforces layer direction as a build failure. |
| pytest | templates/config/pytest.ini | Ecosystem standard runner. |
| pytest with testcontainers | | Real dependencies in containers when a database enters the project. |
| pytest with httpx ASGI transport | | In process API tests, no socket flakiness. |
| pytest with httpx against a running server | | Same runner end to end. |
| pytest-cov | | Feeds the EEP-TEST-03 gate at 85 percent of app code. |
| unittest.mock and pytest monkeypatch | | Standard library, no extra dependency. |
| structlog | templates/config/logging.py | Structured JSON with bound correlation ids. |
| opentelemetry-sdk with FastAPI instrumentation | templates/config/otel.py | Vendor neutral traces from startup. |
| pre-commit | templates/config/pre-commit-config.yaml | The gate runs before the commit exists. |

## Standalone use

Copy this folder plus CONSTITUTION.md into any repository and point your agent at STACK.md; the eep CLI is an accelerator, not a requirement. The scaffold's `make verify` reaches the full gate either way: it runs an installed `eep` when there is one and otherwise falls back to `npx engineering-excellence verify`, so Node 22 is its only extra prerequisite. Without Node at all, the gate is `make test` plus the five shell checks in `checks/manifest.yaml`, which are plain commands you can run by hand; the seven builtin checks are implemented inside the CLI and run only through `eep verify`. The scaffold's `pyproject.toml` ships with a `{{project_name}}` placeholder, so `make setup` and `make test` work once `eep init` has rendered it or you have substituted the token by hand; beyond that, uv and Python 3.11 are the only prerequisites.

## Related

- Law IDs: EEP-ARCH-01, EEP-TEST-01, EEP-TEST-03, EEP-SEC-01, EEP-SEC-02, EEP-OBS-01, EEP-OBS-02, EEP-DLV-01, EEP-DLV-02, EEP-DOCS-01, EEP-DOCS-02, EEP-DEVX-01; declined: EEP-DOCS-03.
- Packs: none. This pack requires no other packs.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-01*
