---
id: EEP-FE-01
domain: FE
title: User interfaces pass automated accessibility checks
version: 1.0.0
status: stable
maturity: standard
severity: blocking
applies_to: [frontend]
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: "2026-08-02"
updated: "2026-08-02"
supersedes: []
related: [EEP-TEST-01, EEP-TEST-03]
---

## Statement

User interfaces pass automated accessibility checks.

## Rationale

An interface that cannot be operated without a pointing device, or that renders text nobody with low vision can read, is broken for a substantial share of the people it was built for, and unlike an ordinary defect it produces no error and no bug report, because the users it excludes cannot get far enough to file one. Automated checks catch the mechanical failures that make up most of what goes wrong in practice: an image with no text alternative, a control with no accessible name, a color pair below the contrast threshold, an input with no associated label. Those are cheap to fix in the minute the markup is written and expensive to fix later, once the same broken pattern has been absorbed into a shared component and repeated across dozens of views. Running the checks inside the build is what keeps them honest, since a review performed once before launch describes an interface that stopped existing with the next change. Automated checks are a floor and not a ceiling: they cannot judge whether a reading order makes sense or whether an interaction is understandable, so they never replace testing with assistive technology.

## Pattern

Accessibility assertions live in the same test suite as behavioral assertions and run under the same command, so a violation turns the build red exactly like a broken behavior instead of landing in a report someone reads later. Each view is asserted in the states a user actually reaches, including the loaded state, the empty state, the error state, and any state where a dialog or menu is open, because a component that is clean while idle can still trap focus or lose its accessible name once it becomes interactive. Shared components carry their own assertions alongside their own definition, so a fix applied once is protected everywhere that component is used.

## Antipatterns

Auditing an interface once before launch and never again produces a clean report about a version of the product that no longer exists, and it is tempting because the audit feels like a finished task rather than the start of a standing obligation. Checking only the first rendered state of a view leaves the states people spend the most time in unverified, so a dialog that never receives focus and a validation message that is never announced both pass unnoticed. Recording violations as warnings that do not fail the build creates a list that only grows, which is a slower and more demoralizing way of not checking at all.

## Check contract

The build fails when automated accessibility checks report violations on the interface's primary states.

## Waiver policy

Waivable with a declared waiver carrying owner and expiry of at most 90 days, except where noted.
