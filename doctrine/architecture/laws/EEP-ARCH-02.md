---
id: EEP-ARCH-02
domain: ARCH
title: A repository implementation is substitutable behind its interface
version: 1.0.0
status: stable
maturity: standard
severity: blocking
applies_to: [data]
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: "2026-08-03"
updated: "2026-08-03"
supersedes: []
related: [EEP-ARCH-01]
---

## Statement

A repository implementation is substitutable behind its interface, behaving identically through that interface no matter which implementation is bound.

## Rationale

Substitutability is what lets a system change how it persists data, starting from an in-memory reference implementation and later moving to a data-backed store, without touching the routes and workflows that sit above the interface and call it. When the layers above depend only on the interface and every implementation behind it behaves the same way, the interface becomes a real seam the system can be cut and reassembled along, rather than a decorative abstraction that still leaks the shape of one particular store. That guarantee holds only when the same contract tests pass against every implementation, so substitutability is something a system proves rather than something it assumes, and an implementation that has never run against the shared suite is a substitution nobody has checked. The moment two implementations diverge in behavior the interface claimed to standardize, the seam is gone and the layers above are silently coupled to whichever one happens to be bound. This law is standard rather than foundational because it presumes an interface already exists and a contract-test suite already describes the behavior every implementation owes it.

## Pattern

The interface owns a suite of contract tests that describes the behavior it requires, and every implementation behind it, the in-memory reference and each data-backed store alike, runs that identical suite and passes it in full. A single dependency-injection layer is the one place a concrete implementation is named and bound, so the choice of which implementation is active is made in exactly one location and the layers above never learn which one they received.

## Antipatterns

Running the contract suite only against the in-memory reference and never against the data-backed store looks like coverage and keeps the suite green, but it leaves the store that actually ships free to diverge from the contract in ways no test would catch. An implementation that leaks storage-specific behavior the interface never promised, such as a particular result ordering or a partial-failure semantic, invites the callers above it to depend on that behavior, so the seam quietly welds itself to one store and the next substitution breaks code that looked correct against the interface.

## Check contract

A check fails when an interface has an implementation that its own contract tests are not all run and passing against, i.e. when the same contract suite is not green against every implementation bound to that interface.

## Waiver policy

Waivable with a declared waiver carrying owner and expiry of at most 90 days, except where noted.
