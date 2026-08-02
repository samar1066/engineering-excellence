---
title: typescript-node golden path
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-02
updated: 2026-08-02
---

# typescript-node golden path

## Purpose

This is the golden path for services built from the typescript-node pack: read it before writing any code. It is written for the AI coding agent or engineer who has just opened the repository and needs to know where code goes, in what order to build it, and what the verification gate will demand. Every path and command below exists in this pack's scaffold, so copy working patterns from it instead of inventing new ones.

## Project shape

The service is a five layer application. One line per directory, one responsibility each:

```
src/
  main.ts                    process entry point: builds the app and listens
  app.ts                     createApp: the composition root, wires logging, tracing,
                             the correlation hook, the error handler, and the routes
  routes/                    HTTP only: parse the request, call one workflow method,
                             shape the response. Owns the wire schemas
  workflows/                 use case orchestration: the only callers of repositories
  domain/                    entities that enforce their own invariants, plus the
                             repository contracts expressed in those entities
  infrastructure/            concrete implementations of the domain contracts
  core/                      cross cutting pieces: config, errors, logging, tracing
test/
  api/                       in process API tests through app.inject, no sockets
  unit/                      pure tests for entities, workflows, and logging
  helpers/app.ts             the fixture that builds and closes an app per test
Makefile                     the four entry points: setup, test, verify, run
package.json                 dependencies, engines, and the npm scripts behind them
.dependency-cruiser.cjs      the layer contracts, enforced as a build failure
vitest.config.ts             test discovery and the 85 percent coverage threshold
```

Dependencies point inward. `src/routes` may call `src/workflows`, which may use `src/domain`; `src/infrastructure` implements the contracts in `src/domain`; `src/domain` imports neither of them. Only `src/app.ts` is allowed to know both a route and a concrete repository exist, because injecting one into the other is its entire job.

Wire schemas and entities look similar but serve different masters. The zod schemas in `src/routes/notes.ts` are the wire contract and change with the API; `noteSchema` in `src/domain/note.ts` is the domain truth and changes with the business. Convert between them in the route, as `toResponse` does when it turns the entity's `Date` into an ISO string.

## The rules of the shape

Five rules keep the shape intact. The verification gate enforces the first two mechanically; reviews hold the rest.

Keep routes thin. A route validates input through its schema, calls exactly one workflow method, and maps the returned entity into a response object. If a route needs a conditional about the domain, that logic belongs in a workflow or an entity, not in `src/routes/`. The pattern to copy is `src/routes/notes.ts`.

Let workflows own orchestration. A workflow coordinates entities and repositories for one use case, and it is the public face of its module: routes call it, tests construct it directly, and nothing reaches around it to touch a repository. The pattern to copy is `src/workflows/notes-workflow.ts`.

Keep the domain pure. Nothing under `src/domain/` imports `src/routes/` or `src/infrastructure/`, and dependency-cruiser fails the build on either edge, type only imports included. The rest of the rule is convention held by review, because no tool checks it for you: domain code also stays free of fastify imports and performs no input or output of its own.

Speak entities at the repository boundary. The contract in `src/domain/note-repository.ts` accepts and returns `Note` values, never rows, driver records, or loose objects. The workflow above the contract must not know or care what storage sits below it.

Validate at the boundary. Every repository implementation parses raw storage data into an entity before returning it, which is why `MemoryNoteRepository` still calls `noteSchema.parse` even though it holds entities already: the moment a database replaces it, that call is the line that turns a malformed row into a loud failure at the edge instead of silent corruption inside a workflow.

## Building a feature

Work test first, outside in. This is the exact order, using the notes feature as the worked example:

1. Write a failing API test in `test/api/notes.test.ts` using the `useApp` fixture from `test/helpers/app.ts`, which builds a fresh application per test and drives it through `app.inject`. Run that one file with the targeted invocation from the Toolchain section and watch it fail.
2. Add the route and its schemas in `src/routes/notes.ts`: the zod request and response schemas, the endpoint calling exactly one workflow method, and the plugin registered in `createApp` in `src/app.ts`.
3. Write a failing workflow unit test in `test/unit/notes-workflow.test.ts`, constructing the workflow directly with `MemoryNoteRepository` or a `vi.fn` backed double. No HTTP involved; run it alone the same way.
4. Implement the workflow in `src/workflows/notes-workflow.ts`: build entities, call the repository through its contract, and translate library failures into domain errors (`NotFoundError` for a missing note, `DomainValidationError` when an invariant rejects the input).
5. Push invariants into the entity: rules that must always hold, like the trimmed non empty title in `src/domain/note.ts`, live on the entity's schema and are tested in `test/unit/note.test.ts`.
6. Define or extend the repository contract in `src/domain/note-repository.ts`: an interface whose methods accept and return entities.
7. Implement that contract in `src/infrastructure/`, as `memory-note-repository.ts` does. A database implementation parses every row into an entity on the way out.
8. Wire the dependency in `src/app.ts`: build the repository, build the workflow around it, and pass the workflow into the route plugin through its options.
9. Go green: run `make test` and the API test from step 1 now passes alongside the unit tests, with line coverage at or above 85 percent.
10. Refactor while the suite stays green, then run `make verify` before you push.

The smallest complete example of this loop is the health endpoint: `test/api/health.test.ts` drives `src/routes/health.ts`. The notes feature is the full pattern with every layer involved.

## Toolchain

The blessed tools. Do not substitute alternatives without a waiver.

| Category | Tool | Command |
|----------|------|---------|
| Runtime | Node 22 or later | declared in `engines` in `package.json` |
| Package manager | npm | `npm ci` |
| Framework | fastify 5 with the zod type provider | wired once in `createApp` |
| Formatter | biome | `npx biome format --write src test` |
| Linter | biome | `npm run lint` |
| Type checker | tsc | `npx tsc --noEmit` |
| Layer boundaries | dependency-cruiser | `npx depcruise --config .dependency-cruiser.cjs src` |
| Unit tests | vitest | `make test` |
| API tests | vitest with `app.inject` | runs inside `make test` |
| Coverage | vitest v8 coverage | `npm run test:cov` |
| Mocking | vitest built in | `vi.fn`, `vi.spyOn`, nothing to install |
| Logging | pino | configured once in `createApp` |
| Tracing | OpenTelemetry node SDK | configured once in `createApp` |
| Hooks | none in the pack | `eep adopt` installs the pre-commit gate |

Daily work drives through four commands:

1. `make setup`: installs dependencies with `npm ci` from the committed lockfile.
2. `make test`: runs the whole suite with the 85 percent line coverage gate.
3. `make verify`: runs the full verification gate through the eep CLI, every check in the table below.
4. `make run`: starts the development server through `tsx watch` with reload.

`make setup` is the only prerequisite for `make test` and `make run`. `make verify` works for everyone: it runs the eep CLI when one is installed and otherwise falls back to `npx engineering-excellence verify`, so its only extra prerequisite is the Node the project already requires.

While iterating, run one file with `npx vitest run test/api/notes.test.ts`, one test with `npx vitest run -t "creates a note"`, or the whole suite in watch mode with `npx vitest`. The coverage gate applies to `npm run test:cov`, not to these targeted runs, so a new red test fails for the right reason instead of tripping the threshold.

Tool configuration lives at the repository root (`biome.json`, `tsconfig.json`, `.dependency-cruiser.cjs`, `vitest.config.ts`) and comes from the pack's blessed templates: edit it only with a waiver. Two details in there are load bearing. Source files import each other by their emitted `.js` specifier because the project is native ESM under NodeNext, and `.dependency-cruiser.cjs` parses through swc so that a type only import still counts as a dependency.

## Observability wiring

`configureLogging` (from `src/core/logging.ts`) and `configureTracing` (from `src/core/otel.ts`) are each called exactly once, at the top of `createApp` in `src/app.ts`. Never call them again elsewhere: the process has one logging pipeline and one tracer provider, and OpenTelemetry refuses to replace a provider that is already global.

Every request gets a correlation id. The `onRequest` hook installed by `installCorrelationId` reads `x-correlation-id` from the caller or mints one, echoes it on the response so a caller can quote it back, and runs the rest of the request inside `runWithCorrelationId`. A pino mixin reads that `AsyncLocalStorage` store on every line, so `correlation_id` lands on each event logged while the request is in flight. When work leaves the request path, a queued message or a background task, wrap it in `runWithCorrelationId` with the same id rather than minting a new one.

Log through the injected logger only, never `console`. Inside a handler that is `request.log`; at startup it is the instance `configureLogging` returned. Pass context as fields rather than formatting it into the message, because a field is queryable and a sentence is not.

## Errors

Errors travel upward as exceptions and become HTTP only at the edge. The flow has three stages, each visible in the notes feature.

Entities enforce invariants in their schema. `noteSchema` in `src/domain/note.ts` trims the title and requires at least one character to survive that trim, so `createNote` throws a `ZodError` when a caller passes only whitespace.

Workflows translate library errors into domain errors from `src/core/errors.ts`, where `ApplicationError` is the base. `NotesWorkflow.createNote` catches the `ZodError` around `createNote` and raises `DomainValidationError` carrying the first issue's message, so no layer above ever has to know zod produced it; `getNote` raises `NotFoundError(resource, key)` when the repository returns null. Anything that is not a `ZodError` is rethrown untouched, because translating an error you did not expect hides it.

The handler registered in `createApp` translates domain errors to HTTP: `NotFoundError` becomes 404 and `DomainValidationError` becomes 422. A request that fails the route's own zod schema, a missing title for example, is also a 422, through the type provider's validation error rather than through a workflow. Everything else is logged with `request.log.error` and becomes a 500 on purpose, because an untranslated error is a server bug and not a client's problem.

Never return error objects, status tuples, or null as a failure signal from a workflow. Throw the specific error and let the handler translate it. A new failure mode means a new class in `src/core/errors.ts`, a workflow that throws it, and a matching branch in `createApp`.

## What verify checks here

`make verify` runs every check in `checks/manifest.yaml`, from the pack's working directory. The four shell checks are plain commands you can run by hand while iterating; the seven builtin checks are implemented inside the eep CLI and run only through `eep verify`, which `make verify` reaches with or without a local install:

| Law | Kind | Command |
|-----|------|---------|
| EEP-ARCH-01 | shell | `npx depcruise --config .dependency-cruiser.cjs src` |
| EEP-TEST-01 | shell | `npx vitest list 2>&1 \| grep . \|\| { echo 'No test files found'; exit 1; }` |
| EEP-TEST-03 | shell | `npm run test:cov` |
| EEP-SEC-01 | builtin | `secrets-scan` |
| EEP-OBS-01 | builtin | `file-contains src/core/logging.ts configureLogging` |
| EEP-OBS-02 | builtin | `file-contains src/core/otel.ts configureTracing` |
| EEP-DLV-01 | builtin | `file-contains-any .github/workflows 'eep verify'` |
| EEP-DLV-02 | shell | `npm ci --dry-run` |
| EEP-DOCS-01 | builtin | `docs-frontmatter docs` |
| EEP-DOCS-02 | builtin | `docs-style .` |
| EEP-DEVX-01 | builtin | `file-contains Makefile setup` |

Three rows deserve a note. EEP-TEST-01 fails on an empty listing rather than trusting the exit code, because `vitest list` prints nothing and succeeds when a project has no tests at all. EEP-DOCS-01 skips itself when no `docs/` directory exists, so a fresh service passes without ceremony. EEP-DLV-01 looks for the gate inside `.github/workflows`, which the scaffold's own `ci.yml` already satisfies, in a standalone service repository and in a composed one alike.

Two laws are declined here rather than implemented. EEP-SEC-02 has no blessed static query analyzer in this toolchain revision and the scaffold builds no queries; when a database layer lands, so does its analyzer. EEP-DOCS-03 is corpus scoped and does not ask a consumer repository to index every directory.

## When you deviate

The golden path is the default, not a cage. When a rule genuinely does not fit, declare a waiver in `.eep/waivers.yaml` naming the law ID, an owner, and an expiry date, with a sentence on why. Never suppress a check inline (a biome ignore comment, a `@ts-expect-error`, a skipped test) without a matching waiver: inline suppressions hide deviations, while waivers keep them visible, owned, and temporary. When the expiry date arrives, fix the code or renew the waiver deliberately.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
