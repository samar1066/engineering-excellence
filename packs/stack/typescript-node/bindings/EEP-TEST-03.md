---
title: EEP-TEST-03 binding
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-02
updated: 2026-08-02
---

## How this stack satisfies it

Coverage is measured with vitest's v8 provider over `src` only, and the
threshold is written into `vitest.config.ts` rather than passed as a flag, so
every way of running the suite carries the same minimum: `npm run test:cov`,
`make test`, and the continuous integration job all fail below it. The suite is
built outside in, which is what puts the measurement on the public surface: an
API test drives the route through `app.inject`, a workflow test constructs the
workflow directly with an in memory repository, and an entity test checks the
invariant on its own. The process entry point `src/main.ts` is excluded because
it only binds a port, and excluding it keeps the number honest instead of
diluting it with a line no test can meaningfully reach.

## The check

`npm run test:cov` (see checks/manifest.yaml) runs the whole suite with
coverage enabled and exits non zero when the line percentage drops below the
declared minimum of 85. The scaffold ships well above that line, so the first
change that adds an untested behavior is what brings the number down, which is
the signal this gate exists to produce. The same command is what the workflow
at `.github/workflows/ci.yml` runs, so a local pass and a pipeline pass mean
the same thing.

## Notes for agents

When coverage falls, add the test for the behavior that lost it rather than
raising the excluded paths in `vitest.config.ts`, and never add a test that
calls a function and asserts nothing about the result: it moves the number
without protecting anything. Write the assertion that would fail if the
behavior broke, and confirm it by breaking the behavior on purpose once before
you move on. While iterating, run one file with
`npx vitest run test/api/notes.test.ts` so a new red test fails for its own
reason instead of tripping the coverage gate.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
