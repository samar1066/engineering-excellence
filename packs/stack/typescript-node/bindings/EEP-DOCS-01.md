---
title: EEP-DOCS-01 binding
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-02
updated: 2026-08-02
---

## How this stack satisfies it

Governed documents in a service built from this pack live under `docs/` and
open with the same frontmatter block the corpus itself uses: a title, a
version, a status, authors, maintainers, and the created and updated dates.
The scaffold ships no `docs/` directory, because a fresh service has nothing
governed to say yet, and the check treats that absence as a pass rather than
something to satisfy with a placeholder page. The service `README.md` stays
outside that scope on purpose: it is the entry point a reader lands on, not a
governed document, so it carries a heading and prose instead of a metadata
block.

## The check

`docs-frontmatter docs` (see checks/manifest.yaml) is a builtin check that
reads every markdown file under `docs/` and fails when one lacks frontmatter or
omits a title or authors, naming each offending file. It skips itself entirely
when no `docs/` directory exists, so the gate stays quiet until the repository
actually has governed documents, and starts holding them the moment it does.

## Notes for agents

When you add the first document under `docs/`, copy the frontmatter block from
this pack's own `STACK.md` rather than inventing fields, and fill in a real
maintainer instead of leaving a placeholder that looks complete to a reader and
fails the moment it is checked. Update the `updated` date in the same change
that edits the body, since a stale date is a quieter lie than a missing one.
Anything genuinely ungoverned, a scratch note or a generated report, belongs
outside `docs/`.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
