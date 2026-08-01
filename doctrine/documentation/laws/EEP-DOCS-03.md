---
id: EEP-DOCS-03
domain: DOCS
title: Every content directory carries a README that stands alone
version: 1.0.0
status: stable
maturity: standard
severity: blocking
applies_to: [corpus]
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-01
updated: 2026-08-01
supersedes: []
related: [EEP-DOCS-01, EEP-DOCS-02, EEP-DEVX-01]
---

## Statement

Every content directory carries a README that stands alone.

## Rationale

A directory with no README is a locked room: a reader who lands there by following a link or browsing the tree has no way to learn what the contents are for without opening every file in turn. This cost falls hardest on new contributors and on any automated tooling that needs a reliable entry point to summarize a directory without parsing every file inside it. Hand maintained indexes are a common substitute, but a list a person edits from memory drifts the moment a file is added, renamed, or removed and nobody remembers to update the list in the same change. A directory that cannot explain itself in isolation forces every reader to reconstruct context that a short, current overview would have given them for free.

## Pattern

Every content directory carries a README that opens with authored prose explaining what the directory holds, who consumes it, and when, followed by a contents section listing the files it governs. The file listing sits inside a clearly marked block that is generated automatically, so the index can be refreshed whenever the directory's contents change without asking a person to maintain it by hand. The authored prose above and below that block carries what only a person can write: purpose, audience, and how the directory relates to the rest of the corpus.

## Antipatterns

The plainest failure is a directory with no README at all, left to be understood only by reading every file inside it or by asking whoever last touched it. A subtler failure is a README whose file listing was written by hand once and never revisited, so it silently drifts out of sync as files are added or removed until the index actively misleads a reader about what the directory contains. Both are tempting because a directory often starts with one or two files that need no explanation, and the README gets added, if at all, only after the directory has grown enough that the gap is already costing readers time.

## Check contract

A check fails when a content directory lacks a README or its generated index block is stale.

## Waiver policy

Waivable with a declared waiver carrying owner and expiry of at most 90 days, except where noted.
