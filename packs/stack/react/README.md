---
title: react
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-02
updated: 2026-08-02
---

# react

A Tier 1 stack pack that binds the Engineering Excellence Program to browser interfaces built with Vite, React 18, and TypeScript in strict mode. A repository matches this pack when its `package.json` contains `react`. The pack turns the program's laws into concrete practice for a frontend component: a golden path document, a runnable scaffold with a worked notes interface designed to pair with the python-fastapi and typescript-node API packs, blessed tool configurations, and executable checks that prove each law it implements, including the accessibility gate that is this pack's reason to exist as a separate stack.

## What this pack gives you

- `STACK.md`: the golden path an AI coding agent reads before writing any code in a React interface.
- A runnable three layer scaffold under `scaffold/` with a complete notes feature: typed API client, state hook, components for all four primary states, and tests at every level including accessibility suites.
- Blessed configuration templates under `templates/config/` for biome, TypeScript, vitest with coverage thresholds, and dependency-cruiser.
- Executable checks in `checks/manifest.yaml` that map each implemented law to the command proving it, one of which fails the build on an accessibility violation.
- One command entry points in the scaffold `Makefile`: `make setup`, `make test`, `make verify`, `make run`.

## Laws implemented

This pack implements ten laws:

- EEP-ARCH-01
- EEP-TEST-01
- EEP-TEST-03
- EEP-FE-01
- EEP-SEC-01
- EEP-DLV-01
- EEP-DLV-02
- EEP-DOCS-01
- EEP-DOCS-02
- EEP-DEVX-01

The how and the why for each law in this stack live in `bindings/<LAW-ID>.md`, one file per law above.

It declines four laws, each with a recorded reason:

| Law | Reason |
|-----|--------|
| EEP-SEC-02 | Backend scoped law. This component opens no data store connection: every query it depends on lives in an API component, whose own pack implements this law. |
| EEP-OBS-01 | Backend scoped law. Server side logs and their correlation ids belong to the API components; this component consumes their responses and surfaces failures on screen. |
| EEP-OBS-02 | Backend scoped law. Trace propagation is owned by the API components a browser calls; browser side telemetry is a product decision rather than a build gate here. |
| EEP-DOCS-03 | Corpus scoped law; consumer repositories are not required to index every directory. |

## Blessed toolchain

| Tool | Config | Rationale |
|------|--------|-----------|
| npm | | Ships with Node, and npm ci restores the committed lockfile exactly. |
| Vite | scaffold/vite.config.ts | Build and dev server, with the API prefix proxied to the backend. |
| React 18 with TypeScript strict | templates/config/tsconfig.json | The UI runtime, typed strictly from the first file. |
| biome format | templates/config/biome.json | One binary formats and lints, so the two can never disagree. |
| biome | templates/config/biome.json | Replaces ESLint and Prettier in a single pass, with no plugin graph to maintain. |
| tsc --noEmit | templates/config/tsconfig.json | Strict from the first file is cheaper than strict later. |
| dependency-cruiser | templates/config/dependency-cruiser.cjs | Turns the components to hooks to api direction into a build failure. |
| vitest with testing-library and jsdom | templates/config/vitest.config.ts | One runner on the Vite pipeline, so a test compiles the way the app does. |
| vitest-axe over the composed interface | templates/config/vitest.config.ts | Renders the whole screen per primary state and fails on an accessibility violation. |
| vitest with a stubbed fetch | | The typed client is proven at its contract instead of against a live server. |
| playwright | | The composed application's browser tool, documented here and installed there, not a dependency of this scaffold. |
| vitest with the v8 provider | templates/config/vitest.config.ts | Feeds the EEP-TEST-03 gate at 85 percent of src, on every metric. |
| vitest vi.fn and vi.stubGlobal | | Built into the runner, so no separate mocking library enters the tree. |

Three toolchain categories are declined rather than filled. Logging and tracing are backend concerns here, for the reasons recorded against EEP-OBS-01 and EEP-OBS-02 above. A local hook manager is declined because `eep adopt` installs the pre commit gate and `make test` is the loop before that.

## Standalone use

Copy this folder plus CONSTITUTION.md into any repository and point your agent at STACK.md; the eep CLI is an accelerator, not a requirement. The scaffold's `make verify` reaches the full gate either way: it runs an installed `eep` when there is one and otherwise falls back to `npx engineering-excellence verify`. Without the CLI at all, the gate is `make test` plus the five shell checks in `checks/manifest.yaml`, which are plain npm and npx commands you can run by hand; the five builtin checks are implemented inside the CLI and run only through `eep verify`. The scaffold's `package.json`, `package-lock.json`, `index.html`, and `README.md` ship with a `{{project_name}}` placeholder, so `make setup` works once `eep init` has rendered it or you have substituted the token by hand; beyond that, Node 22.13 or newer is the only prerequisite.

## Related

- Law IDs: EEP-ARCH-01, EEP-TEST-01, EEP-TEST-03, EEP-FE-01, EEP-SEC-01, EEP-DLV-01, EEP-DLV-02, EEP-DOCS-01, EEP-DOCS-02, EEP-DEVX-01; declined: EEP-SEC-02, EEP-OBS-01, EEP-OBS-02, EEP-DOCS-03.
- Packs: none required. Pairs with python-fastapi or typescript-node, which serve the notes API this scaffold calls.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
