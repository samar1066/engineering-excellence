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

The prose in this pack follows one mechanical rule set rather than individual
taste: two dash code points are banned from sentences, the hyphen is reserved
for identifiers such as file names and flags, and every ordered list starts at
one. Because the rule is mechanical it applies identically to a one line note
in a scaffold README and to the golden path document, and it is enforced by a
check rather than by a reviewer remembering house style. That matters most in a
corpus written partly by agents, where a model's default punctuation habits
would otherwise drift into every new document.

## The check

`docs-style .` (see checks/manifest.yaml) is a builtin check that scans every
markdown file in the repository for the em dash and en dash code points, U+2014
and U+2013, used as prose punctuation, and for any ordered list item numbered
zero. It walks the whole tree in one pass, skipping dependency and build
directories, and reports each offending file and line.

## Notes for agents

When this check fires on a dash, restructure the sentence with a comma, a
period, or parentheses instead of swapping in a hyphen and leaving the sentence
shaped for punctuation it no longer has. When it fires on a zero based list,
renumber from one rather than switching the list to bullets to dodge the rule.
Run it before you consider a document finished: a fix costs nothing while you
are still writing and is embarrassing once a reviewer has already read the file
assuming it was clean.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
