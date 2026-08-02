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

Every governed document this pack itself ships, the golden path in STACK.md,
this binding and its nine siblings, and the pack README, opens with frontmatter
carrying a title, a version, a status, named authors with their handles,
maintainers, and created and updated dates. That is what lets a reader arriving
from a search result learn who owns the document and whether it is current
without reading the body. A consumer repository generated from this pack starts
with no `docs/` directory at all, so it inherits the rule rather than a backlog:
the first governed document someone adds is the first one that has to carry
frontmatter, and the pack's own files are the template to copy.

## The check

`docs-frontmatter docs` (see checks/manifest.yaml) is a builtin check that
validates the frontmatter of every markdown file under a consumer repository's
`docs/` directory against the schema, and reports a missing block, a schema
failure, or absent authors or maintainers. It skips itself when no `docs/`
directory exists, so a fresh interface passes without ceremony and the check
starts biting the moment there is something for it to govern.

## Notes for agents

When this check fails, copy the frontmatter block from any document in this
pack and fill it in honestly rather than pasting a placeholder: an author line
naming nobody real is worse than no line, because it survives review by looking
complete. Set `updated` to the date you actually revised the document, not the
date it was created, and leave `created` alone once it is set. A file under
`docs/` that is genuinely not governed, a scratch note or a generated artifact,
does not belong in `docs/` at all.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
