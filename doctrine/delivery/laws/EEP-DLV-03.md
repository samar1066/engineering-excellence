---
id: EEP-DLV-03
domain: DLV
title: One built artifact promotes through non production before production
version: 1.0.0
status: stable
maturity: standard
severity: blocking
applies_to: [delivery]
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: "2026-08-02"
updated: "2026-08-02"
supersedes: []
related: [EEP-DLV-01, EEP-DLV-02, EEP-DLV-04, EEP-IAC-02]
---

## Statement

One built artifact promotes through non production before production.

## Rationale

Building the artifact separately for each environment means the thing verified before release is not the thing that reaches users, and the gap between the two is exactly where a release defect hides: a dependency that resolved to a newer version, a build flag that differed, a source revision that moved while the pipeline ran. Promoting a single built artifact closes that gap, because the bytes that passed verification are the bytes that serve traffic, leaving configuration as the only intentional variable between environments. Ordering the promotion so a non production environment always receives the artifact first turns every release into a rehearsal that has already happened, which is the cheapest available place to learn that a schema migration is slow or that a required configuration value is missing. Without that ordering, a green build is evidence that the code compiled and its tests passed, never evidence that the artifact starts, connects, and serves requests on real infrastructure. This law is standard rather than foundational because it presumes the verification gate of EEP-DLV-01 already exists and now constrains where its output is allowed to go.

## Pattern

The deployment automation builds once, publishes the artifact under an immutable reference derived from the source revision, and passes that same reference to each environment stage in turn, so the reference named in the production step is textually identical to the one the non production step consumed. Environment stages are ordered explicitly, with the production stage depending on the successful completion of at least one non production stage and gated by an approval a person grants after observing that earlier stage healthy. Everything that legitimately differs between environments arrives as configuration or as a secret resolved at deployment time, never as a separate build of the same source.

## Antipatterns

Triggering a fresh build inside each environment's deployment job is tempting because it keeps every stage self contained and needs no artifact store, but it guarantees the production artifact was never the one anyone verified, and the resulting differences are the hardest kind to reproduce afterward. Offering a direct path that deploys to production without the non production stage is usually introduced for emergencies and then becomes the ordinary route, at which point the promotion order exists only in a document. Promoting by rebuilding from a branch name or a moving tag rather than an immutable reference means two deployments of the same declared version can differ, and the deployment record no longer identifies which source revision is running.

## Check contract

A check proves the deployment automation deploys the same artifact reference to a non production environment before any production deployment step.

## Waiver policy

Waivable with a declared waiver carrying owner and expiry of at most 90 days, except where noted.
