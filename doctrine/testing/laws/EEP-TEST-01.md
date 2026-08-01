---
id: EEP-TEST-01
domain: TEST
title: A test suite exists and runs on every change
version: 1.0.0
status: stable
maturity: foundational
severity: blocking
applies_to: [all]
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: "2026-08-01"
updated: "2026-08-01"
supersedes: []
related: [EEP-TEST-03, EEP-DLV-01]
---

## Statement

A test suite exists and runs on every change.

## Rationale

Untested code is unverifiable inventory: it occupies space in the codebase, but nobody can say with confidence whether it works, and every change made near it is a guess dressed up as an edit rather than a checked fact. A test suite that exists in the repository but is not executed on every change provides no more real assurance than no suite at all, because the discipline that matters is not the presence of test files but their consistent execution at the moment a change is proposed. An empty suite that reports success is worse than an honest absence of tests, since it produces a passing signal that everyone learns to trust, right up until the day that trust is misplaced. This law is foundational because every other testing law in this domain assumes a suite that actually runs; coverage targets and behavioral guarantees have nothing to attach to without it.

## Pattern

One command runs the complete test suite, and that same command is what a contributor runs on a local machine and what the automated verification gate runs on every proposed change, so there is never a gap between what passed for a person and what passed for the gate. Running the suite is wired into the automation that blocks a change from being accepted, not left as a manual, optional step that depends on a contributor remembering to run it under deadline pressure.

## Antipatterns

Tests exist in the repository, but the automated gate skips them, whether because the step was disabled during an incident and never restored, or because the command exits successfully when the test runner is missing rather than failing loudly; either way the suite's mere presence provides false comfort while verifying nothing. A suite reporting zero tests executed as a passing build is a quieter version of the same failure: it satisfies the appearance of "tests ran" while defeating the entire purpose of the law, and it is tempting precisely because reaching that state requires no further work from anyone.

## Check contract

The build fails when the test suite is absent, empty, or not executed by continuous integration on every change.

## Waiver policy

Waivable with a declared waiver carrying owner and expiry of at most 90 days, except where noted.
