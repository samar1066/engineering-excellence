---
title: python-fastapi golden path
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-01
updated: 2026-08-01
---

# python-fastapi golden path

## Purpose

This is the golden path for services built from the python-fastapi pack: read it before writing any code. It is written for the AI coding agent or engineer who has just opened the repository and needs to know where code goes, in what order to build it, and what the verification gate will demand. Every path and command below exists in this pack's scaffold, so copy working patterns from it instead of inventing new ones.

## Project shape

The service is a five layer application. One line per directory, one responsibility each:

```
app/
  main.py            create_app wires logging, tracing, middleware, and exception handlers once
  api/
    deps.py          dependency injection: builds each workflow with its concrete repository
    routes/          HTTP only: parse the request, call one workflow method, shape the response
  core/              cross cutting pieces: config, exceptions, logging setup, tracing setup
  domain/
    entities/        Pydantic models that enforce their own invariants
    interfaces/      abstract repository contracts, expressed in entities
    workflows/       use case orchestration: the only callers of repositories
  infrastructure/
    repositories/    concrete implementations of the domain interfaces
  schemas/           API request and response contracts, used by routes only
tests/
  api/               in process API tests through the httpx ASGI transport
  unit/              pure tests for entities and workflows: no server, no sockets
  conftest.py        app and client fixtures shared by the whole suite
Makefile             the four entry points: setup, test, verify, run
pyproject.toml       dependencies plus the import-linter layer contracts
```

Dependencies point inward: `app.api` may import `app.domain`, `app.infrastructure` implements `app.domain` interfaces, and `app.domain` imports neither of them.

Schemas and entities look similar but serve different masters. Schemas are the wire contract and change with the API; entities are the domain truth and change with the business. Convert between them in the route, as `NoteResponse.model_validate(note.model_dump())` does in `app/api/routes/notes.py`.

## The rules of the shape

Five rules keep the shape intact. The verification gate enforces part of the third mechanically; reviews hold the rest.

Keep routes thin. A route parses input into a schema, calls exactly one workflow method, and maps the returned entity into a response schema. If a route needs a conditional about the domain, that logic belongs in a workflow or an entity, not in `app/api/routes/`. The pattern to copy is `app/api/routes/notes.py`.

Let workflows own orchestration. A workflow coordinates entities, repositories, and transactions for one use case, and it is the public face of its module: routes call it, tests construct it directly, and nothing reaches around it to touch a repository. The pattern to copy is `app/domain/workflows/notes_workflow.py`.

Keep the domain pure. Nothing under `app/domain/` imports `app/infrastructure/` or `app/api/`: import-linter enforces exactly those two forbidden imports through the contracts in `pyproject.toml`, and a violation fails the build. The rest of the rule is convention held by review, because no tool checks it for you: domain code also stays free of FastAPI imports and performs no I/O (no database calls, no network, no file reads).

Speak entities at the repository boundary. Repository interfaces such as `app/domain/interfaces/note_repository.py` accept and return domain entities, never ORM rows, driver records, or raw dicts. The workflow above the interface must not know or care what storage sits below it.

Validate at the boundary. Every repository implementation that reads raw storage data must parse it into an entity before returning it, so a malformed row becomes a loud validation error at the edge instead of silent corruption inside a workflow. The in memory implementation stores entities directly; the moment a database arrives, its repository validates every row into an entity on the way out.

## Building a feature

Work test first, outside in. This is the exact order, using the notes feature as the worked example:

1. Write a failing API test in `tests/api/test_notes_api.py` using the `client` fixture from `tests/conftest.py` (httpx over ASGI, no sockets). Run the file alone with the targeted pytest invocation from the Toolchain section and watch it fail.
2. Add the route and schemas: request and response models in `app/schemas/notes.py`, the endpoint in `app/api/routes/notes.py` calling exactly one workflow method, and the router registered in `create_app` in `app/main.py`.
3. Write a failing workflow unit test in `tests/unit/test_notes_workflow.py`, constructing the workflow directly with an in memory repository or a mock. No HTTP involved; run it alone the same way.
4. Implement the workflow in `app/domain/workflows/notes_workflow.py`: create entities, call the repository through its interface, and translate failures into domain exceptions (`NotFoundError` for a missing note, `DomainValidationError` when entity construction fails).
5. Push invariants into the entity: rules that must always hold, like `title_not_blank` in `app/domain/entities/note.py`, live on the entity as validators and are tested in `tests/unit/test_note_entity.py`.
6. Define or extend the repository interface in `app/domain/interfaces/note_repository.py`: an ABC with async methods that accept and return entities.
7. Implement the interface in `app/infrastructure/repositories/`, as in `memory_note_repository.py`. A database implementation validates rows into entities at the boundary.
8. Wire the dependency in `app/api/deps.py`: `get_notes_workflow` builds the workflow with the concrete repository, and the route receives it through `Depends`.
9. Go green: run `make test` and the API test from step 1 now passes alongside the unit tests, with coverage at or above 85 percent.
10. Refactor while the suite stays green, then run `make verify` before you push.

The smallest complete example of this loop is the health endpoint: `tests/api/test_health.py` drives `app/api/routes/health.py`. The notes feature is the full pattern with every layer involved.

## Toolchain

The blessed tools. Do not substitute alternatives without a waiver.

| Category | Tool | Command |
|----------|------|---------|
| Package manager | uv | `uv sync` |
| Formatter | ruff format | `uv run ruff format .` |
| Linter | ruff | `uv run ruff check .` |
| Type checker | mypy --strict | `uv run mypy app` |
| Layer boundaries | import-linter | `uv run lint-imports` |
| Unit tests | pytest | `make test` |
| Integration tests | pytest with testcontainers | joins `make test` when a database enters the project |
| API tests | pytest with httpx ASGI transport | runs inside `make test` |
| E2E tests | pytest with httpx against a running server | carries the `e2e` marker from `pytest.ini` |
| Coverage | pytest-cov | `uv run pytest --cov=app --cov-fail-under=85 -q` |
| Mocking | unittest.mock and pytest monkeypatch | standard library, nothing to install |
| Logging | structlog | configured once in `create_app` |
| Tracing | opentelemetry-sdk with FastAPI instrumentation | configured once in `create_app` |
| Hooks | pre-commit | `uv run pre-commit install` |

Daily work drives through four commands:

1. `make setup`: installs dependencies with `uv sync` and enables the pre-commit hooks.
2. `make test`: runs the whole suite with the 85 percent coverage gate.
3. `make verify`: runs the full verification gate through the eep CLI, every check in the table below.
4. `make run`: starts the development server through uvicorn with reload.

`make setup` is the only prerequisite for `make test` and `make run`. `make verify` also requires the eep CLI, which is not a scaffold dependency: without the CLI installed, the fallback gate is `make test` plus the five shell checks from the verification table below.

While iterating, run one file with `uv run pytest tests/api/test_notes_api.py -q` or one test with `-k <name>`. The coverage gate applies to `make test`, not to these targeted runs, so a new red test fails for the right reason instead of tripping the coverage threshold.

Tool configuration lives at the repository root (`ruff.toml`, `mypy.ini`, `pytest.ini`, `.pre-commit-config.yaml`) and comes from the pack's blessed templates: edit it only with a waiver.

## Observability wiring

`configure_logging` (from `app/core/logging.py`) and `configure_tracing` (from `app/core/otel.py`) are each called exactly once, at the top of `create_app` in `app/main.py`. Never call them again elsewhere: the process has one logging pipeline and one tracer provider.

Every request gets a correlation id. The HTTP middleware in `create_app` calls `new_correlation_id`, which stores the id in a contextvar; the structlog processor stamps it onto every event logged during that request, and the response returns it in the `x-correlation-id` header so a caller can quote it back when reporting a problem.

Log through structlog only, never print. Get a logger from structlog and pass context as key value pairs rather than formatting strings. The ruff rule set includes T20, so a stray print statement fails lint before it ever reaches review.

## Errors

Errors travel upward as exceptions and become HTTP only at the edge. The flow has three stages, each visible in the notes feature.

Entities enforce invariants with validators that raise `ValueError`, as `title_not_blank` does in `app/domain/entities/note.py`; Pydantic converts that into a `ValidationError` when the entity is constructed.

Workflows translate library errors into domain exceptions from `app/core/exceptions.py`, where `ApplicationError` is the base. `NotesWorkflow.create_note` catches the Pydantic `ValidationError` around `Note.create` and raises `DomainValidationError` carrying the underlying reason; `get_note` raises `NotFoundError(resource, key)` when the repository returns `None`.

The handlers registered in `create_app` in `app/main.py` translate domain exceptions to HTTP: `NotFoundError` becomes 404 and `DomainValidationError` becomes 422. Request schema validation returns 422 through FastAPI itself. A raw Pydantic `ValidationError` reaching the edge means a workflow forgot to translate; that is a server bug, and it becomes a 500 on purpose.

Never return error dicts, status tuples, or `None` as a failure signal from a workflow. Raise the specific exception and let the handler translate it. A new failure mode means a new exception class in `app/core/exceptions.py`, a workflow that raises it, and a matching handler in `app/main.py`.

## What verify checks here

`make verify` runs every check in `checks/manifest.yaml`. The five shell checks are plain commands you can run by hand while iterating; the seven builtin checks are implemented inside the eep CLI and run only through `eep verify`:

| Law | Kind | Command |
|-----|------|---------|
| EEP-ARCH-01 | shell | `uv run lint-imports` |
| EEP-TEST-01 | shell | `uv run pytest --collect-only -q` |
| EEP-TEST-03 | shell | `uv run pytest --cov=app --cov-fail-under=85 -q` |
| EEP-SEC-01 | builtin | `secrets-scan` |
| EEP-SEC-02 | shell | `uv run ruff check --select S608 .` |
| EEP-OBS-01 | builtin | `file-contains app/core/logging.py configure_logging` |
| EEP-OBS-02 | builtin | `file-contains app/core/otel.py configure_tracing` |
| EEP-DLV-01 | builtin | `file-contains-any .github/workflows 'eep verify'` |
| EEP-DLV-02 | shell | `uv lock --check` |
| EEP-DOCS-01 | builtin | `docs-frontmatter docs` |
| EEP-DOCS-02 | builtin | `docs-style .` |
| EEP-DEVX-01 | builtin | `file-contains Makefile setup` |

Two rows deserve a note. EEP-DOCS-01 skips itself when no docs directory exists, so a fresh service passes without ceremony. EEP-DLV-01 looks for the gate inside `.github/workflows`, which the scaffold's `ci.yml` already satisfies.

## When you deviate

The golden path is the default, not a cage. When a rule genuinely does not fit, declare a waiver in `.eep/waivers.yaml` naming the law ID, an owner, and an expiry date, with a sentence on why. Never suppress a check inline (a noqa, a type: ignore, a skipped hook) without a matching waiver: inline suppressions hide deviations, while waivers keep them visible, owned, and temporary. When the expiry date arrives, fix the code or renew the waiver deliberately.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-01*
