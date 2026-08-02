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

The public surface of a frontend is what a person can do with it, so that is
what the suite drives: components are exercised through their rendered roles
and labels with testing-library, never through their internal state, and the
API client is exercised through a stubbed `fetch` at the network boundary. A
refactor that keeps the screen behaving stays green, and a change that breaks
what a user can do goes red, which is the property the law is protecting.
vitest measures the result with the v8 provider over `src`, and the build fails
below 85 percent on lines, branches, functions, and statements alike, because a
branch nobody exercises is a behavior nobody tested.

## The check

`npm run test:cov` (see checks/manifest.yaml) runs the whole suite with
coverage enabled and applies the four thresholds declared in
`vitest.config.ts`. The scaffold's own suite lands at 100 percent on every
metric, so the first uncovered branch a feature adds is visible immediately
rather than being absorbed by slack in the number.

## Notes for agents

Write the failing test in the same change as the behavior, and write it against
what the user perceives: a role, a label, a visible message. When coverage
drops on a diff, the missing test belongs to the code in that diff, so add it
there rather than raising coverage somewhere unrelated. Reaching for a coverage
exclusion is the wrong move in a codebase this small: the entry point in
`src/main.tsx` is covered by a real test that mounts it, and anything else that
feels untestable is usually a hook that wants extracting from a component.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
