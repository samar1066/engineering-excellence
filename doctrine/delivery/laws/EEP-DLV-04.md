---
id: EEP-DLV-04
domain: DLV
title: Production and non production run as separate environments
version: 1.0.0
status: stable
maturity: standard
severity: blocking
applies_to: [infra]
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: "2026-08-02"
updated: "2026-08-02"
supersedes: []
related: [EEP-DLV-03, EEP-IAC-01]
---

## Statement

Production and non production run as separate environments.

## Rationale

An environment that serves users and an environment used to try things out carry entirely different risk profiles, and sharing infrastructure between them means they also share a blast radius: one misapplied change, one exhausted quota, or one runaway process in the experimental workload degrades the workload people depend on. Separation is what makes a promotion sequence meaningful, because a rehearsal performed against production data stores and production network paths is not a rehearsal at all, it is an unannounced production change. Isolation also gives an incident somewhere to be reproduced, so a defect can be exercised repeatedly against realistic infrastructure without any attempt being visible to a user. The cost of sharing stays hidden until it presents as an outage nobody intended and nobody can immediately explain, because the change that caused it was aimed somewhere else entirely. This law is standard rather than foundational because it has nothing to constrain until a project declares its environments as code, and it governs systems that deploy running environments rather than every governed repository.

## Pattern

The infrastructure definition declares at least two environments, one production and one non production, instantiated from the same parameterized template so they differ in scale, naming, and access rather than in shape, which means a change proven in one is genuine evidence about the other. Each environment owns its own data stores, network boundaries, credentials, and access grants, so no process running in a non production environment holds a credential that resolves to a production resource. Adding a further environment is a matter of instantiating the same template with another stage parameter, keeping the number of environments a deployment decision rather than a rewrite.

## Antipatterns

Running a non production workload inside the production environment under a different name or namespace looks isolated on a diagram while sharing the quotas, network paths, and often the data stores that actually determine the blast radius. Pointing a non production deployment at the production data store to obtain realistic data is tempting because it removes the work of seeding, and it silently converts every experiment into a change against records real users depend on. Maintaining a non production environment that was built by hand and has since diverged from production teaches the wrong lesson, because a change that passes there proves very little about the environment it will eventually reach.

## Check contract

A check fails when the infrastructure definition declares fewer than two isolated environments.

## Waiver policy

Waivable with a declared waiver carrying owner and expiry of at most 90 days, except where noted.
