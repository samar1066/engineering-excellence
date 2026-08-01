---
title: The Constitution
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-01
updated: 2026-08-01
---

# The Constitution

This is the constitution of the Engineering Excellence Program. Twelve tenets
govern every line of code written under it, by human or agent. Laws in
`doctrine/` derive from these tenets. Packs bind laws to your stack.
`eep verify` proves compliance. The tenet beats habit; the law beats preference.

## The twelve tenets

1. **Laziness is a discipline.** Anything done twice by hand becomes a script,
   a template, or a generator the third time. Effort spent on repetition is
   effort stolen from judgment.
2. **The golden path is the easiest path.** The correct way to build something
   must also be the most convenient way. Scaffold. Never hand roll what a
   template generates.
3. **Boundaries before features.** Every capability lives in a module with one
   responsibility and a public contract. Consumers depend on the contract,
   never on the internals.
4. **Tests are the specification.** A behavior exists only when a test fails in
   its absence. Write the failing test first and let it drive the design.
5. **Machines enforce, prose persuades.** Every rule carries an automated
   check. A rule without a check is a suggestion, and suggestions do not
   survive deadlines.
6. **Observable from the first commit.** Structured logs, distributed traces,
   and correlation identifiers are wiring, not features. What you cannot see,
   you cannot operate.
7. **Secure by construction.** Secrets never enter version control. Inputs are
   validated at every boundary. Access follows least privilege. Security is a
   property of the design, not a review stage.
8. **Small steps, always reversible.** Ship small diffs behind safe defaults
   with a rollback path. Anything hard to undo gets designed twice.
9. **One source of truth.** Intent is stated once and generated everywhere
   else. Duplication is the seed of drift.
10. **Performance and cost are features.** Budgets are declared, measured, and
    enforced like tests. Slow and wasteful are defects, not surprises to
    discover in production.
11. **Deviations are declared, never silent.** A rule that cannot be followed
    is waived in the open: justified, owned, and expiring. Undeclared debt is
    a lie to your future team.
12. **Leave it better, and sign your work.** Every artifact carries its author
    and maintainer. Improvement arrives through the contract, and credit flows
    back to the contributor.

## How an agent uses this corpus

1. Read this file. It always fits in context.
2. Read the `STACK.md` of each pack active for the repository (listed in
   `.eep/lock.yaml`, or the pack folder you were given). Follow its golden
   path. Consult `bindings/` when you need the law behind a rule.
3. Before declaring any work done, run `eep verify`. If a check fails, run
   `eep explain <LAW-ID>` and fix the cause, not the check.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-01*
