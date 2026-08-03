---
title: aws-dynamodb golden path
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-03
updated: 2026-08-03
---

# aws-dynamodb golden path

## Purpose

This is the golden path for persisting an entity with DynamoDB in a project built from the aws-dynamodb pack: read it before adding a store. It is written for the AI coding agent or engineer who has a backend with a repository interface and an in memory reference and now needs the same behavior backed by a real table. Every path and command below exists in this pack's scaffold, so copy working patterns from it instead of inventing new ones. The pack supplies persistence for a backend it sits beside; it does not scaffold the application, and the interface it implements is the backend pack's, not its own.

## Project shape

The data component is one small polyglot project. One line per directory, one responsibility each:

```
data/
  dynamodb.json        the detect marker and the shared names: the table name variable and the partition key
  construct/
    note-table.ts      the table construct: encryption, point in time recovery, on demand billing, an id key, and tags
    note-table.test.ts vitest assertions over the rendered template: encryption, recovery, tags
  wiring/
    python/
      dynamo_note_repository.py  DynamoNoteRepository over aioboto3, table name from the environment
      reference/                 faithful copies of the backend Note, the interface, and the in memory impl
      tests/                     the contract suite, run against both implementations
      pyproject.toml             the Python project for the adapter and its suite
    typescript/
      dynamo-note-repository.ts  the adapter over the aws-sdk document client, endpoint overridable
      reference/                 faithful copies of the backend note, the interface, and the in memory impl
      contract.test.ts           the contract suite, run against both implementations
  local/
    docker-compose.dynamodb-local.yaml   amazon/dynamodb-local pinned by digest
  scripts/
    contract-suite.sh    brings DynamoDB Local up, runs both suites against both implementations, tears it down
  package.json           the Node project for the construct and the TypeScript adapter
  tsconfig.json
  biome.json
  vitest.config.ts
```

The adapter is the only code that knows DynamoDB is below the interface. Everything above it, the routes and the workflows in the backend, keeps speaking the domain entity and never learns which store answered.

## The rules of the shape

Three rules keep the seam honest, and the contract suite enforces the first mechanically.

One suite, every implementation. The behavior the interface promises lives in one contract suite, and both the in memory reference and the DynamoDB adapter run it unchanged. An implementation that has never run the suite is a substitution nobody has checked, so a new store is not done until its column of the suite is green.

Speak entities at the boundary. The adapter accepts and returns the same domain entity the interface declares, marshalling it to an item on the way into the table and validating it back into an entity on the way out, so a malformed row fails loudly at the edge rather than silently inside a workflow.

Bind the store in one place. The concrete adapter is named only at the dependency injection site. Swapping the reference for the DynamoDB adapter is a one line change there, and nothing above it is touched.

## Adding a persisted entity

Work from the interface outward. This is the exact order, using the notes feature as the worked example:

1. Define the entity and its interface in the backend, as `app/domain/entities/note.py` and `app/domain/interfaces/note_repository.py` already do for notes: an entity that enforces its own invariants, and an abstract repository whose async methods accept and return that entity.
2. Describe the behavior in the contract suite. Add each method's expected behavior to `wiring/python/tests` and `wiring/typescript/contract.test.ts` as a test that runs against a repository fixture, not against one named implementation, so the same assertions judge every store.
3. Keep the in memory reference passing. The reference under `reference/` is the backend's own `MemoryNoteRepository`, and it is the first column of the suite to go green, which proves the suite describes behavior an implementation can actually meet.
4. Implement the DynamoDB adapter from the shown pattern. Copy `wiring/python/dynamo_note_repository.py` or `wiring/typescript/dynamo-note-repository.ts`: read the table name from the environment variable named in `dynamodb.json`, accept an endpoint override for DynamoDB Local, marshal the entity to an item on `add`, and validate items back into entities on `get` and `list_all`.
5. Provision the table. Copy `construct/note-table.ts`: a table with a partition key named `id`, encryption at rest on, point in time recovery on, on demand billing, and owner plus environment tags. Compose it into the aws-cdk service stack so it deploys beside the service, and keep its assertions in `note-table.test.ts`.
6. Wire the dependency. In `app/api/deps.py`, import `DynamoNoteRepository` and build the workflow with it in place of `MemoryNoteRepository`, reading the table name and endpoint from configuration. This one line is the whole substitution.
7. Prove both implementations. Run `bash scripts/contract-suite.sh`: it brings up DynamoDB Local, runs the contract suite against the reference and against the adapter in both languages, and fails if either implementation diverges. Run `npm run test:construct` alongside it to prove the table still declares encryption, recovery, and tags.

The smallest complete example of this loop is the notes feature itself: the reference and the adapter both pass the shipped contract suite, and the construct assertions cover the table.

The adapter is proven by the contract suite against a real local store, not by the backend's fast unit tests, so it stays out of the backend's unit coverage measurement: the backend's `pyproject.toml` excludes `dynamo_*_repository.py` under `[tool.coverage.run]`. That exclusion is what lets a project add a second or an Nth persisted resource without each uncovered adapter sinking the coverage gate. Do not add a backend unit test for the adapter to lift coverage; add the new method's column to the contract suite instead, which is where a real store is exercised.

## Toolchain

The blessed tools. Do not substitute alternatives without a waiver.

| Category | Tool | Command |
|----------|------|---------|
| Language | TypeScript strict | `npm run build` |
| Runtime | python 3.11 | declared as `requires-python` in `wiring/python/pyproject.toml` |
| Infrastructure library | aws-cdk-lib v2 | `npm run test:construct` |
| Package manager | npm | `npm ci` |
| Formatter | biome format | `npx biome format --write .` |
| Linter | biome | `npm run lint` |
| Type checker | tsc --noEmit | `npm run build` |
| Unit tests | vitest with aws-cdk-lib assertions | `npm run test:construct` |
| Integration tests | pytest and vitest against DynamoDB Local | `bash scripts/contract-suite.sh` |

Daily work drives through a few commands:

1. `npm ci` and `pip install -e wiring/python`: install the Node and Python projects.
2. `npm run test:construct`: assert on the rendered table template, credential free.
3. `bash scripts/contract-suite.sh`: run the contract suite against both implementations with DynamoDB Local.
4. `npm run build`: typecheck the construct and the TypeScript adapter.

The contract suite is the one command that needs Docker, because DynamoDB Local runs as a container. Everything else, including the construct assertions, needs neither Docker nor an AWS account.

## What verify checks here

`make verify` runs every check in `checks/manifest.yaml`, from the `data` directory. All four are shell checks you can run by hand while iterating:

| Law | Kind | Command |
|-----|------|---------|
| EEP-SEC-04 | shell | `npm run test:construct -- -t "encrypts the table at rest"` |
| EEP-REL-02 | shell | `npm run test:construct -- -t "keeps point in time recovery"` |
| EEP-COST-01 | shell | `npm run test:construct -- -t "tags the table with an owner and an environment"` |
| EEP-ARCH-02 | shell | `bash scripts/contract-suite.sh` |

Three of the four synthesize the table in process and read the rendered template, so they need no AWS account and no Docker. The fourth is the substitutability proof, and it needs Docker because it runs the contract suite against DynamoDB Local: a check that only exercised the in memory reference would keep itself green while the store that ships drifted, which is the antipattern EEP-ARCH-02 names.

Thirteen laws are declined by this pack rather than implemented, because they are scoped to the application the backend pack owns or to the pipeline the delivery pack owns. The reasons are recorded one by one in `pack.yaml` and summarized in the pack README.

## When you deviate

The golden path is the default, not a cage. When a rule genuinely does not fit, declare a waiver in `.eep/waivers.yaml` naming the law ID, an owner, and an expiry date, with a sentence on why. Never suppress a check inline without a matching waiver: inline suppressions hide deviations, while waivers keep them visible, owned, and temporary.

One deviation is worth naming in advance. A single table with an `id` partition key fits an entity looked up by its own id, which the note is. An entity queried by another attribute needs a different key schema or a secondary index, which belongs on the construct with its own assertion and its own line in the contract suite, not bolted onto the adapter at read time. Add the access pattern to the table, not a scan around it.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-03*
