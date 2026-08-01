---
title: EEP-DOCS-01 binding
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-01
updated: 2026-08-01
---

## How this stack satisfies it

Every governed markdown file this pack's golden path produces, from a
project's own docs entries to this pack's own bindings, opens with the same
frontmatter block: title, version, status, authors, maintainers, created, and
updated. That shape is fixed by the corpus templates rather than left to
whoever writes the next document, so a schema can validate it instead of a
reviewer eyeballing whether attribution is present. A consumer repository that
has no docs directory yet is not penalized for it; the check only applies once
that directory exists.

## The check

`docs-frontmatter docs` (see checks/manifest.yaml) is a builtin check that
walks the consumer repository's docs directory, validates each markdown file's
frontmatter against the schema, and skips entirely when no docs directory is
present. It reports every offending file in one run, a missing frontmatter
block, a field that fails schema validation, and a document missing authors or
maintainers all included.

## Notes for agents

If this check fails on a document you touched, add or correct the frontmatter
block at the top of the file rather than editing the body to work around the
failure; copy the shape from an existing governed document in the same
repository. Every document needs a real author and at least one maintainer; a
placeholder handle will not pass schema validation. If a whole new docs
directory is being introduced, settle the frontmatter shape once, from a
template, before the second file is written, so it never drifts between the
first two documents.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-01*
