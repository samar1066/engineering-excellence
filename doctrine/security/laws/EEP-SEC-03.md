---
id: EEP-SEC-03
domain: SEC
title: Every component runs with least privilege and holds no access it does not use
version: 1.0.0
status: stable
maturity: standard
severity: blocking
applies_to: [infra]
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: "2026-08-03"
updated: "2026-08-03"
supersedes: []
related: [EEP-SEC-04, EEP-IAC-01]
---

## Statement

Every component runs with least privilege and holds no access it does not use.

## Rationale

An access grant that exceeds what a component actually does is a standing liability: if that component is ever compromised, the blast radius is defined by what it was permitted to reach rather than by what it needed, and the permissions it never exercised become the attacker's inventory. Broad grants are tempting because they make a component work on the first try and remove a whole class of permission errors from the development loop, but the cost is paid later and by someone else, when an incident reviewer has to reason about everything the grant allowed instead of the narrow set the code uses. Scoping every grant to the specific operations and the specific resources a component names turns permission into documentation, because the access declaration then becomes an accurate description of what the component can do. This law is standard rather than foundational because it presumes a component's operations are already declared somewhere a check can read them. Least privilege is cheapest to establish at the moment a grant is written, since widening a grant later is a one line change while narrowing one already in production risks breaking a path nobody remembers depends on it.

## Pattern

Each component is granted only the operations its declared behavior performs, and each grant names the specific resources it acts on rather than a wildcard over a whole class of them, so the permission set reads as a list of exactly what the component touches. Grants are derived from the component's declared operations rather than copied from a broad template, and a review step compares the two so a permission that no operation exercises is removed before it ships.

## Antipatterns

Granting a component full access to a category of resources so that it never fails on a missing permission during development looks efficient and keeps the build green, but it hands any future compromise the run of everything in that category rather than the one resource the component reads. Reusing a single broad access profile across many components because writing a scoped one for each is tedious collapses the boundary between them, so a weakness in the least important component inherits the reach of the most privileged one that shares the profile.

## Check contract

A check fails when a component is granted an access right that its declared operations do not require, or when access grants are defined more broadly than the resources a component names.

## Waiver policy

Waivable with a declared waiver carrying owner and expiry of at most 90 days, except where noted.
