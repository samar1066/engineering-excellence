---
id: EEP-TEST-03
domain: TEST
title: Every public behavior has a test that fails when the behavior breaks
version: 1.0.0
status: stable
maturity: standard
severity: blocking
applies_to: [all]
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: "2026-08-01"
updated: "2026-08-01"
supersedes: []
related: [EEP-TEST-01, EEP-ARCH-01]
---

## Statement

Every public behavior has a test that fails when the behavior breaks.

## Rationale

Coverage measured against the public surface, rather than against raw executed lines, is what predicts whether a regression actually gets caught, because a line of code can execute during a test run without a single meaningful assertion checking what it produced. The entire purpose of a test is to fail the moment a public behavior changes in a way nobody intended; a suite that stays green through a genuine behavioral break has failed at its one job no matter how many lines it touched along the way. If deleting a passing assertion does not turn the build red, that assertion was decoration rather than verification, and any coverage number that counted it was fiction. This law is standard rather than foundational because it depends on EEP-TEST-01's suite already existing and running; it raises the bar from "tests run" to "tests prove something true about the public surface."

## Pattern

The default development loop writes a failing test for the next piece of public behavior first, writes the minimum code needed to make that test pass, and then refactors with the test standing as a safety net, so coverage of the public surface becomes a natural byproduct of how the code was built rather than a number chased after the fact. Coverage of the public API surface is measured on every change and reported against a declared minimum, so a regression in coverage is visible immediately rather than discovered later when the untested path fails in front of a user.

## Antipatterns

A test that calls a function and asserts nothing about its result, or asserts only that no exception was raised, exercises the code path without verifying the behavior it was meant to protect; it inflates a raw coverage number while proving nothing, and it is tempting to write because it is fast and easy to mistake for a real test in a quick review. Chasing a raw coverage percentage by thoroughly testing simple internal helpers while leaving complex public behavior untested produces an impressive number and a false sense of safety, since the metric rewards the volume of lines touched rather than the behaviors that callers actually depend on.

## Check contract

The build fails when a public behavior loses its covering test. Coverage of the public API surface is measured and reported with a declared minimum.

## Waiver policy

Waivable with a declared waiver carrying owner and expiry of at most 90 days, except where noted.
