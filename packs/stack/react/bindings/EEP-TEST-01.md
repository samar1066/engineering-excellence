---
title: EEP-TEST-01 binding
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-02
updated: 2026-08-02
---

## How this stack satisfies it

vitest is the only runner in this stack, and it shares the Vite pipeline the
application itself builds with, so a test compiles the same TypeScript and JSX
the browser receives. The scaffold ships a suite that already covers all three
layers, `tests/unit` for the client and the hook, `tests/components` for the
rendered states, and `tests/a11y` for the accessibility gate, so a repository
generated from this pack is never in the state this law exists to prevent. The
CI workflow in `.github/workflows/ci.yml` runs that suite on every push to the
default branch and on every pull request, which is the second half of what the
law asks.

## The check

`npx vitest list --filesOnly 2>&1 | grep .` (see checks/manifest.yaml) asks
vitest to enumerate the test files it would run, without running any of them,
and fails when the enumeration comes back empty. The `grep .` is what makes an
empty suite a non zero exit: `vitest list` prints nothing and exits zero when
it finds no files, so the enumeration alone could not fail. The manifest also
carries `fail_if_stdout_matches: "No test files found"`, which catches the
same condition from the other direction if a future vitest reports it in words
instead.

## Notes for agents

If this check fails, the cause is almost always the include patterns in
`vitest.config.ts` disagreeing with where the tests actually live: the pack
collects `tests/**/*.test.ts` and `tests/**/*.test.tsx`, so a file named
`*.spec.ts` or a suite parked next to its component is invisible to the runner
even though it looks like a test. Move the file rather than widening the
pattern, so one convention keeps holding. Never make this check pass by
deleting the failing test that revealed a bug; a suite that collects but proves
nothing satisfies this law and violates EEP-TEST-03.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
