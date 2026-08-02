---
title: react golden path
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-02
updated: 2026-08-02
---

# react golden path

## Purpose

This is the golden path for interfaces built from the react pack: read it before writing any code. It is written for the AI coding agent or engineer who has just opened the component and needs to know where code goes, in what order to build it, and what the verification gate will demand. Every path and command below exists in this pack's scaffold, so copy working patterns from it instead of inventing new ones. The scaffold is a notes interface that calls a notes API, the same one the python-fastapi and typescript-node packs scaffold, so a composed application has a working pair from the first commit.

## Project shape

The interface is a three layer application. One line per directory, one responsibility each:

```
src/
  main.tsx           mounts App into #root, the only file that touches the DOM directly
  api/
    notes.ts         typed client: owns the base URL, fetch, status handling, and the wire types
  hooks/
    useNotes.ts      state and orchestration: loading, error, data, and the actions a screen calls
  components/
    App.tsx          composes the screen and switches on the primary states
    NotesList.tsx    the populated state
    NoteForm.tsx     the write path
  env.d.ts           declares every VITE_ variable this interface is allowed to read
tests/
  unit/              the client and the hook, with fetch stubbed
  components/        rendered behavior through roles and labels
  a11y/              the accessibility gate, one case per primary state
  support/           shared fixtures and fetch stubs
  setup.ts           cleanup, stub restoration, and matcher registration for the whole suite
Makefile             the four entry points: setup, test, verify, run
package.json         scripts and dependencies, pinned by package-lock.json
```

Dependencies point one way: `src/components` may import `src/hooks`, `src/hooks` imports `src/api`, and `src/api` imports neither of them.

Wire types and view props look similar but serve different masters. The types in `src/api/notes.ts` are the shape the server sends and change when the API changes; props are what a component needs and change when the screen changes. Components never import the client for either, not even for a type: `src/hooks/useNotes.ts` re-exports `Note` and `NoteDraft`, and that re-export is the legal way for a component to name a wire type.

## The rules of the shape

Five rules keep the shape intact. The boundary check enforces the first three mechanically; reviews hold the rest.

Keep components free of the network. A component renders props and calls handlers. It never calls `fetch`, never imports `src/api`, and never knows a URL exists. The pattern to copy is `src/components/NotesList.tsx`, which takes notes and renders them, and `src/components/App.tsx`, which takes everything it needs from one hook.

Let hooks own orchestration. A hook coordinates the client, the loading flag, the error, and the actions for one screen, and it is the public face of that data: components call it, tests call it directly through `renderHook`, and nothing reaches around it. The pattern to copy is `src/hooks/useNotes.ts`.

Keep the client dumb and total. `src/api/notes.ts` owns the base URL, serialization, and status handling, and it turns every failure, a bad status or a dead transport, into one thrown `Error` with a message worth showing. It knows nothing about React, and it holds no state.

Speak roles and labels, not divs. Every interactive control is a real element with a real label, every asynchronous state is announced (`role="status"` while loading, `role="alert"` on failure), and every region is named by a heading it points at with `aria-labelledby`. This is what makes the accessibility gate pass on the merits rather than by decoration, and it is what makes tests readable, since a test that queries by role is a test written the way a user reads the screen.

Validate at the boundary. The client is the last place raw server data exists as an unknown shape. Everything above it works with the declared types, so a change in the API becomes a compile error in one file instead of a runtime surprise in three components.

## Building a feature

Work test first, outside in. This is the exact order, using the notes interface as the worked example:

1. Write a failing component test in `tests/components/app.test.tsx` that describes the new behavior the way a user would meet it, querying by role, label, or visible text. Run the file alone with the targeted vitest invocation from the Toolchain section and watch it fail.
2. Write a failing accessibility case in `tests/a11y/app-states.a11y.test.tsx` if the change adds or alters a primary state. A new state with no case is a state the gate cannot see.
3. Add or extend the component in `src/components/`, taking everything it needs as props or from one hook. Keep the markup semantic: a label element for every field, a button element for every action.
4. Write a failing hook test in `tests/unit/use-notes.test.ts`, driving the hook through `renderHook` with `fetch` stubbed by the helpers in `tests/support/notes.ts`. No components involved.
5. Implement the state in `src/hooks/useNotes.ts`: set loading around the call, translate a thrown error into a message the screen can show, and expose actions as stable callbacks.
6. Write a failing client test in `tests/unit/notes-client.test.ts` covering the request shape and both failure modes, a bad status and a dead transport.
7. Implement the call in `src/api/notes.ts`, reusing the shared `request` helper so the base URL, headers, and error translation stay in one place.
8. Go green: run `make test`, and the tests from steps 1, 2, 4, and 6 pass together with coverage at or above 85 percent on every metric.
9. Refactor while the suite stays green, then run `make verify` before you push.

The smallest complete example of this loop is `NoteForm`: `tests/components/note-form.test.tsx` drives `src/components/NoteForm.tsx` with nothing else involved. The notes feature is the full pattern with all three layers and the four states.

## Toolchain

The blessed tools. Do not substitute alternatives without a waiver.

| Category | Tool | Command |
|----------|------|---------|
| Package manager | npm | `npm ci` |
| Build and dev server | Vite | `npm run build`, `npm run dev` |
| UI runtime | React 18 with TypeScript strict | |
| Formatter | biome format | `npx biome format --write .` |
| Linter | biome | `npm run lint` |
| Type checker | tsc --noEmit | `npx tsc --noEmit` |
| Layer boundaries | dependency-cruiser | `npx depcruise --config .dependency-cruiser.cjs src` |
| Unit tests | vitest with testing-library and jsdom | `npm test` |
| Accessibility tests | vitest-axe | `npm run test:a11y` |
| API client tests | vitest with a stubbed fetch | runs inside `npm test` |
| E2E tests | playwright | owned by the composed application, not installed here |
| Coverage | vitest with the v8 provider | `npm run test:cov` |
| Mocking | vitest vi.fn and vi.stubGlobal | built into the runner |

Daily work drives through four commands:

1. `make setup`: installs the locked dependency tree with `npm ci`.
2. `make test`: runs the suite with the 85 percent coverage gate, then the accessibility gate.
3. `make verify`: runs the full verification gate through the eep CLI, every check in the table below.
4. `make run`: starts the Vite dev server on port 5173, proxying `/api` to a backend on port 8000.

`make setup` is the only prerequisite for `make test` and `make run`. `make verify` works for everyone: it runs the eep CLI when one is installed and otherwise falls back to `npx engineering-excellence verify`.

While iterating, run one file with `npx vitest run tests/components/app.test.tsx` or one case with `-t <name>`. The coverage gate applies to `npm run test:cov`, not to these targeted runs, so a new red test fails for the right reason instead of tripping the threshold.

Tool configuration lives at the component root (`biome.json`, `tsconfig.json`, `vitest.config.ts`, `.dependency-cruiser.cjs`, `vite.config.ts`) and comes from the pack's blessed templates: edit it only with a waiver.

## Accessibility

This interface has four primary states, and every one of them is a screen a real person can land on:

1. Loading, while the first request is in flight. Announced with `role="status"`, so a screen reader says something is happening instead of reading silence.
2. Empty, when the API returns nothing. A sentence that says so, not a blank region.
3. Error, when the request fails. Announced with `role="alert"`, with the failure message and a control that retries.
4. Populated, when there is data. A labelled region, a real list, one article per item with its own heading.

`tests/a11y/app-states.a11y.test.tsx` renders the composed `App` once per state against a stubbed API and asserts axe-core reports zero violations. Organizing the suite by state rather than by component is the point: the defects that survive review are the ones in the states nobody screenshots, the spinner nobody announces and the error banner nobody hears. `npm run test:a11y` runs that directory alone, so a failure names accessibility and nothing else, and the same command runs in CI and inside `make test`.

The colour contrast rule is disabled in that suite and nowhere else, because jsdom paints nothing and cannot evaluate it. Contrast belongs to the composed application's browser suite, which is where playwright lives. Every other axe rule runs.

When a state grows, add its case in the same change. When the gate fails, read the rule name in the output and fix the markup: a real label beats `aria-label`, a real button beats a clickable div, and a heading that names a region beats an attribute bolted onto it. Narrowing the rule set to reach green is a waiver conversation, not a fix.

## States and failures

Failures travel upward as thrown errors and become screen states at the top. The flow has three stages, each visible in the notes feature.

The client throws. `src/api/notes.ts` turns a non `ok` response into an `Error` naming the method, path, and status, and a dead transport into an `Error` saying the API could not be reached. It never returns `null`, an error tuple, or a partially filled object as a failure signal.

The hook catches and translates. `src/hooks/useNotes.ts` catches around every call, stores a message in `error`, and always clears `loading` in a `finally`, so a failed request can never leave the screen spinning forever. A rejection that is not an `Error` still produces a readable sentence rather than the word `undefined`.

The component renders the state. `src/components/App.tsx` switches on `loading`, `error`, and the length of the list, and each branch is a complete screen with the announcement its state needs. A component never inspects a status code or a thrown value; by the time data reaches it, the decision has already been made one layer down.

A new failure mode means a new message from the client, a hook that surfaces it, and a state the component renders for it, with a test at each level and an accessibility case if the screen it produces is new.

## What verify checks here

`make verify` runs every check in `checks/manifest.yaml`. The five shell checks are plain commands you can run by hand while iterating; the five builtin checks are implemented inside the eep CLI and run only through `eep verify`, which `make verify` reaches with or without a local install:

| Law | Kind | Command |
|-----|------|---------|
| EEP-ARCH-01 | shell | `npx depcruise --config .dependency-cruiser.cjs src` |
| EEP-TEST-01 | shell | `npx vitest list --filesOnly 2>&1 \| grep .` |
| EEP-TEST-03 | shell | `npm run test:cov` |
| EEP-FE-01 | shell | `npm run test:a11y` |
| EEP-SEC-01 | builtin | `secrets-scan` |
| EEP-DLV-01 | builtin | `file-contains-any .github/workflows 'eep verify'` |
| EEP-DLV-02 | shell | `npm ci --dry-run` |
| EEP-DOCS-01 | builtin | `docs-frontmatter docs` |
| EEP-DOCS-02 | builtin | `docs-style .` |
| EEP-DEVX-01 | builtin | `file-contains Makefile setup` |

Three rows deserve a note. EEP-TEST-01 pipes the file listing through `grep .` because `vitest list` prints nothing and exits zero when it finds no tests, so the pipe is what turns an empty suite into a failure. EEP-DOCS-01 skips itself when no docs directory exists, so a fresh interface passes without ceremony. EEP-DLV-01 looks for the gate inside `.github/workflows`, which the scaffold's `ci.yml` already satisfies.

Four laws are declined by this pack rather than implemented: EEP-SEC-02, EEP-OBS-01, and EEP-OBS-02 are backend scoped, and belong to the API components this interface calls; EEP-DOCS-03 is corpus scoped. The reasons are recorded in `pack.yaml` and summarized in the pack README.

## When you deviate

The golden path is the default, not a cage. When a rule genuinely does not fit, declare a waiver in `.eep/waivers.yaml` naming the law ID, an owner, and an expiry date, with a sentence on why. Never suppress a check inline (a biome-ignore, a ts-expect-error, a disabled axe rule, a skipped test) without a matching waiver: inline suppressions hide deviations, while waivers keep them visible, owned, and temporary. When the expiry date arrives, fix the code or renew the waiver deliberately.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
