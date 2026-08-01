---
id: EEP-SEC-01
domain: SEC
title: Secrets never enter version control
version: 1.0.0
status: stable
maturity: foundational
severity: blocking
waivable: false
applies_to: [all]
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: "2026-08-01"
updated: "2026-08-01"
supersedes: []
related: [EEP-SEC-02, EEP-DLV-01]
---

## Statement

Secrets never enter version control.

## Rationale

A secret committed to version control is compromised at the moment the commit becomes shared, because history is durable: removing the file in a later commit does not erase it from clones, forks, and cached copies that already exist, and even rewriting history afterward cannot guarantee that every downstream copy has been purged. Rotation, replacing the credential and revoking the old one, is the only real remedy once a secret has been exposed, and prevention is categorically cheaper than that remedy, since remediation requires finding every system the secret touched and coordinating a rotation without causing an outage. This is why the law is foundational and blocking: no other control, including code review or access policy, reduces the damage once plaintext credential material has left the building inside a commit. Because the cost of a single miss is effectively unbounded and irreversible, this is the one law in the corpus with no waiver path at all.

## Pattern

Configuration that varies by environment, or that must remain secret, is injected at runtime through environment variables or a dedicated secrets manager, and is never written into a file that version control tracks. The scan that enforces this runs twice: once locally before a commit is even created, so a contributor catches the mistake before it reaches shared history, and again in continuous integration, so a scan that was bypassed, disabled, or simply not run locally still cannot let a secret through.

## Antipatterns

Committing a file of environment values "temporarily" to unblock a deploy, with a plan to remove it later, is the single most common way secrets enter shared history, and it is tempting because it is the fastest path to a working setup in the moment. Trusting an ignore rule added after the fact to have prevented exposure overlooks that the file may already have been tracked from an earlier commit, or that a teammate's existing clone predates the new rule; the only state that is actually safe is one where the secret was never written to a tracked file in the first place.

## Check contract

An automated scan of tracked files and staged changes fails on credential material, keys, or tokens, and runs both locally before commit and in continuous integration.

## Waiver policy

Never waivable.
