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

Vitest is the single runner for every level this toolchain declares: entity and
workflow unit tests, and API tests driven through `app.inject`. One
configuration, `vitest.config.ts`, decides what counts as a test file, so
discovery is the same on a contributor's machine, in `make test`, and in the
workflow at `.github/workflows/ci.yml`. A repository scaffolded from this pack
starts with `test/unit` and `test/api` already populated, so discovery never
starts from zero by accident.

## The check

`npx vitest list 2>&1 | grep . || { echo 'No test files found'; exit 1; }`
(see checks/manifest.yaml) asks vitest to enumerate the tests it would run
without executing any of them, and treats an empty listing as a failure. The
guard is the point: on its own, `vitest list` prints nothing and exits zero
when a project has no tests at all, which is exactly the vacuous pass this law
exists to prevent, so the command turns silence into a failure and the manifest
also fails on the printed sentinel. It separates two failure modes an agent
must tell apart: a missing or misconfigured suite, caught here, and a suite
that exists but fails, caught by EEP-TEST-03.

## Notes for agents

If this check fails, the fix is a real test file under a path
`vitest.config.ts` already includes, not a widened include pattern to make
discovery quieter. Check the common causes first: a file that does not end in
`.test.ts`, or one that landed outside `test/`. Never add a placeholder test
whose only purpose is to make the listing non empty; write the first real test
for the behavior you are about to build instead.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
