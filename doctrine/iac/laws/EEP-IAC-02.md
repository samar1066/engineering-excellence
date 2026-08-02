---
id: EEP-IAC-02
domain: IAC
title: Services ship as container images built from version controlled definitions
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
related: [EEP-IAC-01, EEP-DLV-03]
---

## Statement

Services ship as container images built from version controlled definitions.

## Rationale

A service assembled differently on every machine it lands on cannot be diagnosed from its source alone, because the runtime it depends on is a property of the host rather than of the code under review. Building the service into an image from a definition kept in version control pulls the runtime into the reviewed change: the language version, the system libraries, the file layout, and the start command all move through the same review and history as the code they carry. The payoff arrives at the worst moment, when a service fails in one environment and works in another and somebody has to explain the difference quickly; with the runtime declared beside the code, that difference is a readable change rather than an investigation across hosts. A definition that exists but is never exercised is a slower version of the same problem, because a malformed instruction or a missing build stage is then discovered by the deployment that needed to succeed. This law is standard rather than foundational because it governs components deployed as running services, not every governed repository.

## Pattern

Every deployable service component in the repository carries exactly one image definition committed next to its source, and that definition installs dependencies from the same pinned manifest a contributor installs from locally, so the image and the development machine resolve the identical dependency graph. The definition is parsed or built on every change by the verification gate, which catches a malformed instruction or a missing stage while the change is still under review instead of during a release. The resulting image is built once, tagged with the exact source revision it came from, and treated as immutable, so the artifact running in one environment is provably the one that passed verification in another.

## Antipatterns

Installing dependencies onto a long lived host and copying application files over the top leaves no reviewable record of what the runtime contains, which is tempting because it is quick and keeps working until two hosts diverge and one of them starts failing for reasons that appear nowhere in the source. Keeping an image definition that no automation ever parses or builds lets a broken instruction sit unnoticed for weeks, and the failure then surfaces at the moment with the least time available to understand it. Rebuilding the image separately for each environment from a floating base reference means the artifact reaching users was never the artifact that passed verification, which gives up the main reason to build an image in the first place.

## Check contract

A check fails when a declared service component lacks a container definition in version control or the definition fails a syntax check.

## Waiver policy

Waivable with a declared waiver carrying owner and expiry of at most 90 days, except where noted.
