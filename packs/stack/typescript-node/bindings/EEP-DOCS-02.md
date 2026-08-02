---
title: EEP-DOCS-02 binding
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-02
updated: 2026-08-02
---

## How this stack satisfies it

Every markdown file this pack ships, and every one a service generated from it
adds, follows one mechanical rule set rather than individual taste: two
specific dash code points are banned from prose, hyphens are reserved for
identifiers such as file names and flags, and every ordered list starts
counting at one. Because the rule is mechanical it applies the same way to a
one line note in a pull request template and to a long governed document under
`docs/`, and it is settled by a check rather than by whichever reviewer read
the file. That keeps a corpus written by many contributors, human and agent,
uniform without spending review attention on punctuation.

## The check

`docs-style .` (see checks/manifest.yaml) is a builtin check that scans every
markdown file in the repository for the em dash and en dash code points,
U+2014 and U+2013, and for any ordered list item numbered zero, reporting each
file and line it finds. It runs across the whole tree in one pass, so a
violation in a README is caught by the same command that checks the governed
documents.

## Notes for agents

When this fails on a banned dash, rewrite the sentence with a comma, a colon,
a period, or parentheses rather than swapping in a visually similar character;
a plain hyphen is correct only where the text is genuinely an identifier. When
it fails on a zero based list, renumber from one instead of dropping the
numbering for bullets to dodge the rule. Run this check on a document before
you call it finished, since the fix is seconds inline and expensive once the
document has been reviewed and merged as clean.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
