---
id: EEP-REL-01
domain: REL
title: Every deployment has a health check and an automatic rollback path
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
related: [EEP-REL-02, EEP-DLV-03]
---

## Statement

Every deployment has a health check and an automatic rollback path.

## Rationale

A deployment with no health check declares success the instant the new version starts, not when it is actually able to serve, so a process that comes up and then fails its first real request is reported as healthy while users meet the failure. An automatic rollback path is what bounds the damage when a bad version does ship, because without one, recovery waits on a human noticing, diagnosing, and manually reversing the change, and every minute of that is downtime the deployment itself could have ended. Together the two turn a failed release from an incident into a non event, since the health check detects that the new version cannot serve and the rollback returns the last version that could, with no person in the loop. This law is standard rather than foundational because it governs components that are deployed as running services, not every governed repository. The cost of adding both is paid once when the deployment automation is written, while the cost of omitting them is paid during a failing release, at the moment the least time is available to react.

## Pattern

Every deployable service exposes a health check that reports ready only when the service can actually handle a request, and the deployment automation waits on that check before it shifts traffic to the new version, so a version that starts but cannot serve never receives live load. The automation retains the previous known good version and carries a path that restores it automatically when the health check fails, so a bad release is reversed by the pipeline rather than by a human paging through logs at the moment of failure.

## Antipatterns

Treating process startup as readiness, so traffic shifts the moment the new version's process is running, ships a version that may fail every real request while the deployment reports success, and it is tempting because a running process is the easiest signal to check. Shipping a new version with no retained previous one and no automated way back, on the assumption that a broken release can simply be fixed forward, means the only route out of a failure is building and deploying yet another version under exactly the time pressure that makes a second mistake likely.

## Check contract

A check fails when a deployable service declares no health check, or when the deployment automation has no path that returns the previous known good version on failure.

## Waiver policy

Waivable with a declared waiver carrying owner and expiry of at most 90 days, except where noted.
