---
title: EEP-FE-01 binding
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-02
updated: 2026-08-02
---

## How this stack satisfies it

axe-core runs inside the same vitest and jsdom setup the component tests use,
driven by vitest-axe, so the accessibility rules see the real rendered output of
the real components rather than a static snapshot of markup someone hand wrote.
The suites live in `tests/a11y` and are organized by state, not by component:
this interface has four primary states, loading, empty, error, and populated,
and each one gets a case that renders the composed `App` against a stubbed API
and asserts axe reports nothing. Organizing by state is what makes the gate
meaningful, because most real accessibility defects appear in the states nobody
screenshots: the spinner with no announcement, the error banner no screen
reader is told about, the empty state that leaves the region unlabelled. The
components are written to pass on the merits rather than to satisfy the rules,
with every control carrying a real label, the busy state announced through a
status role, and failures announced through an alert role.

## The check

`npm run test:a11y` (see checks/manifest.yaml) runs the `tests/a11y` directory
alone, so a failure here names accessibility and nothing else, and it runs in
under a second. Each case asserts zero violations on one primary state, and the
failure output quotes the offending element, the rule that fired, and the list
of ways to satisfy it. The colour contrast rule is disabled in this suite and
only there, because jsdom paints nothing and cannot evaluate it; contrast
belongs to the composed application's browser suite. The same command runs in
`.github/workflows/ci.yml` and inside `make test`, so the gate is identical
locally and in continuous integration.

## Notes for agents

When this check fails, read the rule name in the output before touching
anything: axe tells you which element it found and every way to fix it, and the
right fix is nearly always markup rather than an ARIA attribute bolted on top.
A visible `<label htmlFor>` beats `aria-label`, a real `<button>` beats a
clickable `<div>` with `role="button"`, and a heading that names a region beats
a bare `aria-label` on a `<section>`. When you add a state to a screen, add its
case to `tests/a11y` in the same change, since a state with no case is a state
this gate cannot see. Never narrow the rule set to get green: disabling a rule
is a waiver conversation, and the only rule disabled in this pack is disabled
because the environment cannot run it at all.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
