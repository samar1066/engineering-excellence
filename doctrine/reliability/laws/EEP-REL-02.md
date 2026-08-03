---
id: EEP-REL-02
domain: REL
title: Every persistent data store has backups and a defined recovery point
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
related: [EEP-REL-01, EEP-SEC-04]
---

## Statement

Every persistent data store has backups and a defined recovery point.

## Rationale

A persistent data store with no backup is a single copy of data whose loss is permanent, because a mistaken deletion, a corrupting write, or a failure of the underlying medium takes the only copy with it, and no amount of redundancy inside that store protects against a change that is faithfully replicated to every replica. A recovery point objective states how much recent data an organization has decided it can afford to lose, and without one declared, the backup that exists has no target to meet and its adequacy cannot be judged until a real recovery discovers the gap. Declaring the objective turns recovery from a hope into a measurable property, because the backup cadence is chosen to satisfy the stated tolerance, and a cadence that cannot meet it is a visible failure rather than a surprise found during an outage. This law is standard rather than foundational because it presumes the persistent data stores it governs are already declared where a check can enumerate them. Backups are cheapest to configure when the data store is first declared, and most expensive to wish for in the moment after data is already gone.

## Pattern

Every declared persistent data store has a backup mechanism enabled, and it carries a stated recovery point objective that fixes the maximum acceptable window of data loss, so the backup cadence has an explicit target to satisfy. The backups are verified by an actual restore rather than assumed from the fact that a backup job runs, because a backup that has never been restored is an untested claim, and the recovery point is the yardstick that restore is measured against.

## Antipatterns

Relying on replication inside the data store as if it were a backup protects against a lost node but not against a destructive change, since a deletion or a corrupting write is copied to every replica just as faithfully as a legitimate one, leaving no earlier state to return to. Enabling a backup job but never declaring a recovery point objective and never testing a restore produces a comforting green status and an unknown real exposure, so the first time anyone learns how much data the setup can lose is during the outage where it matters most.

## Check contract

A check fails when a declared persistent data store enables no backup mechanism or declares no recovery point objective.

## Waiver policy

Waivable with a declared waiver carrying owner and expiry of at most 90 days, except where noted.
