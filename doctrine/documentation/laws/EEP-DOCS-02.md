---
id: EEP-DOCS-02
domain: DOCS
title: Documents follow the writing style rules
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
related: [EEP-DOCS-01, EEP-DOCS-03]
---

## Statement

Documents follow the writing style rules.

## Rationale

A corpus written by many hands across years drifts toward inconsistency unless the smallest stylistic choices are settled once and enforced mechanically instead of argued over again in every review. Punctuation choices, like which character separates a clause or where a numbered list begins counting, feel trivial in isolation, but multiplied across hundreds of documents they become visible noise that erodes the impression of a single coherent voice. Rules a machine can check remove the recurring argument over personal preference, which carries little value, and let review attention go to the content of a document instead of its formatting. A style rule that exists only as a memory in one reviewer's head is not really a rule: it decays the moment that reviewer stops reading every document.

## Pattern

The style rules are expressed as a small, fixed set of mechanical checks: specific punctuation characters are disallowed in favor of plainer alternatives, and any ordered list or numbered label begins counting from one rather than zero. The same check runs at every point a document is written, reviewed, or published, so a violation is caught at the earliest possible moment instead of being discovered by a reader after the document ships.

## Antipatterns

Style enforced by taste means every reviewer applies a slightly different standard, so a document that satisfies one reviewer fails the next reviewer's judgment of the very same text, and the resulting argument wastes review time that should go to content. A specific version of this failure is a document that substitutes the banned em dash or en dash character for a plain hyphen, a comma, or a rephrased sentence, because the wider mark reads as more polished in isolation while quietly reintroducing the exact character the rule exists to keep out. A second specific version is a step list or numbered section that begins counting at zero because it mirrors a habit borrowed from indexing, which feels natural to the author but breaks consistency with every other numbered list in the corpus that begins at one.

## Check contract

A check fails on any dash punctuation character U+2014 or U+2013, or any ordered list or numbered label starting at zero.

## Waiver policy

Waivable with a declared waiver carrying owner and expiry of at most 90 days, except where noted.
