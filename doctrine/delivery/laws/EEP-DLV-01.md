---
id: EEP-DLV-01
domain: DLV
title: Continuous integration gates every change
version: 1.0.0
status: stable
maturity: foundational
severity: blocking
applies_to: [all]
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-01
updated: 2026-08-01
supersedes: []
related: ["EEP-TEST-01", "EEP-DLV-02"]
---

## Statement

Continuous integration gates every change.

## Rationale

Every change that merges without being verified is a small bet that it works, and those bets compound: by the time a defect surfaces, it may be buried under dozens of later changes, each of which now has to be checked before anyone can be sure which one is responsible. A gate that runs automatically on every pull request and every push to the default branch removes the bet: nothing merges, and nothing lands on the branch everyone builds on top of, without first passing the same verification every earlier change had to pass. Configuration that exists but does not block, or that a change can route around, provides the appearance of safety without the substance, which is worse than having no gate because it invites false confidence. Consistent, automated verification is also what makes delivery fast in practice: a team that trusts its gate can merge and release with confidence instead of relying on manual review to catch what automation should have caught.

## Pattern

Define the verification gate as a single command or a small fixed sequence of commands that any contributor can run locally, and configure continuous integration to run exactly that same command rather than a second, drifting definition of what passing means. Trigger that gate automatically on every pull request and on every push to the default branch, and require it to pass before a change can merge or land, with no routine manual override. Keep the gate fast enough that contributors run it before pushing, so most failures are caught before they ever reach continuous integration, not only by it.

## Antipatterns

Continuous integration that runs and reports but is not required to pass before merge is often described as advisory: it produces a status nobody is blocked by, which over time everyone learns to ignore, and that is functionally identical to having no gate at all. A gate that exists only in a contributor's local environment, undocumented and unautomated, depends entirely on individual discipline and erodes the first time someone is in a hurry. Divergence between the local check and the automated one, such as a local script that skips a step the pipeline still runs, produces a false sense of security: a change looks clean locally and only fails once a pull request is already open.

## Check contract

A check fails when no continuous integration configuration exists or when it does not run the verification gate on every pull request and push to the default branch.

## Waiver policy

Waivable with a declared waiver carrying owner and expiry of at most 90 days, except where noted.
