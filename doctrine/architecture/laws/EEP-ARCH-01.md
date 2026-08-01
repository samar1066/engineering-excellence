---
id: EEP-ARCH-01
domain: ARCH
title: Layers depend in one direction through declared contracts
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
related: [EEP-TEST-03]
---

## Statement

Layers depend in one direction through declared contracts.

## Rationale

Entangled imports make change cost explode: when an inner layer reaches into an outer layer, or two modules import each other's internals, a change in one place forces a coordinated, simultaneous change everywhere it touches, and the blast radius of a small edit becomes unpredictable. The dependency rule borrowed from hexagonal architecture states that source code dependencies may only point inward, toward stable abstractions, and never outward toward volatile detail such as a particular delivery mechanism or storage technology. Without an enforced direction, the core business rules of a system become impossible to test in isolation, impossible to reuse behind a different delivery mechanism, and impossible to change without also changing the code that surrounds them. This law is standard rather than foundational because it assumes a system has already been organized into layers and modules; its job is to keep that organization honest as the system grows and the temptation to take a shortcut increases.

## Pattern

The application core stays pure and exposes a small set of declared contracts; outer layers implement those contracts and are the only code permitted to depend on a concrete external system, such as a particular storage engine or delivery channel. Interface adapters live at the edges of the system, translating between the outside world and the core's abstractions, so the pure core never has to know that any particular adapter exists. When one module needs a capability owned by another module, it calls through that module's declared public contract only, never through an internal file, class, or function that the owning module did not intend to expose.

## Antipatterns

Business logic that imports the web framework, a queue client, or a storage driver directly ties a domain rule to a delivery mechanism, and makes that rule impossible to test without booting the entire stack around it. Reaching into another module's internal folder because the needed function is "right there" and adding a proper contract feels like overhead is tempting in the moment, but every such shortcut adds a dependency the boundary check cannot see, and the next attempt to change or extract that module inherits a hidden coupling nobody documented. Left unchecked, these shortcuts accumulate into a dependency graph with cycles, where no single part can be changed, tested, or replaced without touching the rest.

## Check contract

An automated boundary check fails the build when code in an outer layer is imported by an inner layer or when a module bypasses another module's public contract.

## Waiver policy

Waivable with a declared waiver carrying owner and expiry of at most 90 days, except where noted.
