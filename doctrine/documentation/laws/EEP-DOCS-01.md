---
id: EEP-DOCS-01
domain: DOCS
title: Every governed document carries valid, attributed frontmatter
version: 1.0.0
status: stable
maturity: standard
severity: blocking
applies_to: [docs]
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-01
updated: 2026-08-01
supersedes: []
related: [EEP-DOCS-02, EEP-DOCS-03]
---

## Statement

Every governed document carries valid, attributed frontmatter.

## Rationale

Frontmatter is the machine readable contract that turns a document from a paragraph of prose into a governed asset. Without a declared owner and a maintainer, a document has no one to route a review request to, no one to notify when it drifts out of date, and no signal for a reader trying to judge whether the content is still trustworthy. Orphaned documents accumulate silently until a project is carrying pages of guidance that nobody remembers writing and nobody will defend in a review. A missing or malformed frontmatter field is cheap to catch at the moment a document is written and expensive to unwind once dozens of other documents have copied the same gap.

## Pattern

Every governed document declares its frontmatter as a single structured block at the top of the file: an identifier or title, a version, a status, one or more authors, and at least one maintainer, plus creation and update dates. Anything a reader needs to know about who owns a document and how current it is comes from that one block rather than from scattered prose or reconstructed version history. A visible footer line, generated from the same frontmatter fields, repeats the attribution at the point where a reader finishes the document, so authorship stays visible without sending the reader back to search the structured data at the top of the file.

## Antipatterns

The most common failure is the document with no frontmatter at all: a heading and body that reads fine until someone needs to know who to ask about it or whether it is still accurate. A subtler failure is frontmatter that exists but is incomplete, an authors field left as a placeholder, a maintainers list never filled in, or a status never advanced past draft, which looks compliant at a glance but fails the moment it is checked mechanically. Both are tempting because writing the content feels like the real work and filling in structured metadata feels like paperwork, right up until the document needs revision and nobody can say who is responsible for it.

## Check contract

A check fails when a governed markdown document lacks frontmatter, fails schema validation, or omits authors or maintainers.

## Waiver policy

Waivable with a declared waiver carrying owner and expiry of at most 90 days, except where noted.
