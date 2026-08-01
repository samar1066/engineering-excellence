---
title: EEP-SEC-02 binding
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-01
updated: 2026-08-01
---

## How this stack satisfies it

Ruff is this stack's linter, and rule S608 rides inside that same single pass:
it flags any data store query text built through an f-string, percent
formatting, format calls, or plain string concatenation with a runtime value
spliced in. Because the rule ships inside the same `ruff check` invocation
that already gates formatting and style, a consumer repository gets this
protection the moment it adopts the pack's linter configuration, with no
separate security tool to install or maintain. The blessed pattern is
placeholders bound through the driver's own parameter substitution, everywhere
a query is built, migrations included.

## The check

`uv run ruff check --select S608 .` (see checks/manifest.yaml) runs only the
S608 rule across the repository and fails on the first file where query text
is assembled from a runtime value instead of passed as a bound parameter.
Scoping the invocation to one rule keeps this check's output specific to query
construction, separate from the broader style and formatting findings the full
`ruff check` run reports elsewhere in the toolchain.

## Notes for agents

When this check fails, rewrite the flagged query to pass the runtime value as
a parameter to the driver instead of interpolating it into the query text,
rather than suppressing the finding with an inline ignore comment. If the
value truly cannot be parameterized, a column or table name chosen dynamically
for example, validate it against an explicit allow list before use and leave a
comment explaining why parameter binding does not apply. Treat an inline noqa
for S608 as something a reviewer should question by default, not a routine
fix.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-01*
