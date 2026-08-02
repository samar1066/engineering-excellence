---
title: typescript-node
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-02
updated: 2026-08-02
---

# typescript-node

A Tier 1 stack pack that binds the Engineering Excellence Program, program version 0.2.0, to Node 22 services built on Fastify 5 and TypeScript. A repository matches this pack when its `package.json` contains `fastify`. The pack turns the program's laws into concrete practice for this stack: a golden path document, a runnable scaffold with a worked example feature, blessed tool configurations, and executable checks that prove each law it implements.

## What this pack gives you

- `STACK.md`: the golden path an AI coding agent reads before writing any code in a Fastify service.
- A runnable five layer scaffold under `scaffold/` with a complete notes feature: routes and wire schemas, workflow, entity, repository contract, in memory implementation, and tests at every level.
- Blessed configuration templates under `templates/config/` for biome, TypeScript, dependency-cruiser, vitest, pino, and OpenTelemetry.
- Executable checks in `checks/manifest.yaml` that map each implemented law to the command proving it.
- One command entry points in the scaffold `Makefile`: `make setup`, `make test`, `make verify`, `make run`.

## Laws implemented

This pack implements eleven laws:

- EEP-ARCH-01
- EEP-TEST-01
- EEP-TEST-03
- EEP-SEC-01
- EEP-OBS-01
- EEP-OBS-02
- EEP-DLV-01
- EEP-DLV-02
- EEP-DOCS-01
- EEP-DOCS-02
- EEP-DEVX-01

The how and the why for each law in this stack live in `bindings/<LAW-ID>.md`, one file per law above.

It declines two laws:

- EEP-SEC-02, with the recorded reason "No blessed static SQL analyzer in this toolchain revision and the scaffold constructs no queries; a database layer with its analyzer arrives in a later pack revision."
- EEP-DOCS-03, with the recorded reason "Corpus scoped law; consumer repositories are not required to index every directory."

## Blessed toolchain

| Tool | Config | Rationale |
|------|--------|-----------|
| npm | | Ships with Node 22, writes a lockfile by default, and npm ci is the reproducible install. |
| Node 22 or later | | Declared in `engines` in the scaffold's package.json so an older Node fails at install. |
| fastify 5 with the zod type provider | | One schema per route validates the request and types the handler from the same declaration. |
| biome (formatter) | templates/config/biome.json | One tool with the linter, one config, zero drift. |
| biome (linter) | templates/config/biome.json | Replaces ESLint and Prettier in a single pass. |
| tsc --noEmit | templates/config/tsconfig.json | Strict from day one is cheaper than strict later. |
| dependency-cruiser | templates/config/dependency-cruiser.cjs | Enforces layer direction as a build failure, type only imports included. |
| vitest | templates/config/vitest.config.ts | One runner for every level, native TypeScript, no build step. |
| vitest with fastify inject | | In process API tests, no ports and no socket flakiness. |
| vitest v8 coverage | templates/config/vitest.config.ts | Feeds the EEP-TEST-03 gate at 85 percent of src, enforced in the config rather than a flag. |
| vitest built in mocking | | vi.fn and vi.spyOn ship with the runner, no extra dependency. |
| pino | templates/config/logging.ts | Structured JSON with a correlation id carried through AsyncLocalStorage. |
| OpenTelemetry node SDK | templates/config/otel.ts | Vendor neutral traces from startup, fastify entry points instrumented. |
| none (hooks) | | eep adopt installs the pre-commit gate, so the pack adds no second hook manager. |

The runtime and framework rows are `runtime` and `framework` entries in `pack.yaml`, not prose alone; both are also enforced by the scaffold itself, through `engines` and through the `fastify` dependency the pack detects on.

## Standalone use

Copy this folder plus CONSTITUTION.md into any repository and point your agent at STACK.md; the eep CLI is an accelerator, not a requirement. The scaffold's `make verify` reaches the full gate either way: it runs an installed `eep` when there is one and otherwise falls back to `npx engineering-excellence verify`, and Node is already this stack's runtime. Without the CLI at all, the gate is `make test` plus the four shell checks in `checks/manifest.yaml`, which are plain commands you can run by hand; the seven builtin checks are implemented inside the CLI and run only through `eep verify`. The scaffold's `package.json` and `package-lock.json` ship with a `{{project_name}}` placeholder, so `make setup` and `make test` work once `eep init` has rendered it or you have substituted the token by hand; beyond that, Node 22 is the only prerequisite.

## Related

- Law IDs: EEP-ARCH-01, EEP-TEST-01, EEP-TEST-03, EEP-SEC-01, EEP-OBS-01, EEP-OBS-02, EEP-DLV-01, EEP-DLV-02, EEP-DOCS-01, EEP-DOCS-02, EEP-DEVX-01; declined: EEP-SEC-02, EEP-DOCS-03.
- Packs: none. This pack requires no other packs.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
