---
id: EEP-DEVX-01
domain: DEVX
title: One command takes a fresh clone to a working setup
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
related: [EEP-DOCS-03, EEP-DLV-01]
---

## Statement

One command takes a fresh clone to a working setup.

## Rationale

Every extra manual step between cloning a repository and running it is a tax paid not once but by every contributor who ever joins the project, repeated for as long as the codebase lives. A setup process that depends on tribal knowledge, an outdated page, or a sequence of commands someone has to remember correctly is a recurring source of lost time and a common reason a new contributor gives up before making a first change. The cost compounds because manual instructions rot: environments change, dependencies move, and a written list of steps silently falls out of sync with what the project actually needs, while a single executable command fails loudly the moment it breaks. Reducing setup to one command does not just save time, it removes a whole category of bugs that only ever show up on one contributor's machine because their manual steps diverged slightly from everyone else's.

## Pattern

A fresh clone reaches a working, verified setup through exactly one documented command, run from the repository root with no undocumented prerequisites beyond the basic tooling the project declares it needs. That single command is wired into the project's own automation entry point rather than left as a suggestion in prose, so it is the same command a new contributor runs, a continuous integration job runs, and a returning contributor runs after pulling changes. The command's job is to install dependencies, apply any needed configuration, and verify the result actually works, so success or failure is unambiguous instead of inferred.

## Antipatterns

The classic failure is a README with a dozen manual steps: install this, configure that, copy a file here, remember to run one more command that is not mentioned until step nine. Each step looks reasonable in isolation to the person who wrote it, which is exactly why the list grows unchecked over time, but a newcomer following it in order hits a missing prerequisite or a stale instruction with no way to tell whether they made a mistake or the documentation is simply wrong. A related antipattern is a setup command that exists but lives only in one contributor's personal notes or shell history, never captured in the project's own automation, so it helps exactly one person and nobody else.

## Check contract

A check fails when the repository lacks a documented single setup command or the command is absent from the automation entry point.

## Waiver policy

Waivable with a declared waiver carrying owner and expiry of at most 90 days, except where noted.
