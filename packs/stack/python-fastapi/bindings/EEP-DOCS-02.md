---
title: EEP-DOCS-02 binding
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-01
updated: 2026-08-01
---

## How this stack satisfies it

This stack's documentation follows one mechanical style rule set rather than
individual taste: two specific dash code points are banned from prose, hyphens
are reserved for identifiers such as file names and flags, and every ordered
list starts at one. Because the rule is mechanical, it applies the same way to
a short docstring and to a long governed document, and it is enforced by a
check rather than a reviewer remembering the house style. This keeps a corpus
written by many contributors, human and agent, visually and mechanically
uniform.

## The check

`docs-style .` (see checks/manifest.yaml) is a builtin check that scans every
markdown file in the consumer repository for the em dash and en dash code
points, U+2014 and U+2013, used as prose punctuation, and for any ordered list
item numbered zero. It runs across the whole repository tree in one pass and
reports each offending file and line.

## Notes for agents

If this check fails on a banned dash character, replace it with a comma, a
period, parentheses, or a plain hyphen where the usage is genuinely an
identifier, rather than leaving the sentence structure unchanged. If it fails
on a zero based ordered list, renumber the list to start at one; do not delete
the numbering and switch to bullets to dodge the rule. Run this check on a
document before treating it as finished, since a fix is cheap inline and
expensive once a document has already been reviewed and merged on the
assumption it was clean. Files named CLAUDE.md and AGENTS.md are excluded at
every depth, because eep only co owns them: the block it generates inside such
a file is style clean by construction, and the prose a repository keeps around
that block is the repository's own rather than governed corpus documentation.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-01*
