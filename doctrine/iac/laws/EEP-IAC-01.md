---
id: EEP-IAC-01
domain: IAC
title: Infrastructure is declared as code and changes preview before they apply
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
related: [EEP-IAC-02, EEP-DLV-04]
---

## Statement

Infrastructure is declared as code and changes preview before they apply.

## Rationale

Infrastructure that exists only as a sequence of manual actions taken in a web console is a system nobody can review, reproduce, or roll back, because the only record of how it was built is the memory of whoever built it. Declaring it as code in the same repository as the software it runs turns every environment change into a reviewable difference with an author, a reason, and a history, and it makes rebuilding a lost environment a matter of evaluating the definition again rather than reconstructing it from recollection. The preview step matters as much as the declaration: the cost of an infrastructure mistake is measured in deleted data stores and severed network paths, and no downstream test suite can undo either one. Rendering what will change before anything changes converts an irreversible action into a reviewable one, so a destructive replacement is caught by a reader rather than discovered by an outage. This law is standard rather than foundational because it presumes a project already has an automated verification gate for the preview to run in.

## Pattern

The infrastructure definition lives in version control beside the application code it provisions, is written so the automation can evaluate it with no human input, and produces the same result on every run from a clean checkout, so no environment depends on state that exists on one contributor's machine alone. The automation exposes two distinct entry points: one that renders the pending change as a readable plan while touching nothing, and one that applies it, with the rendered plan attached to the change under review so an approver sees which resources will be created, replaced, or destroyed before approving. Values that differ between environments enter the definition as parameters rather than as separately maintained copies of the same definition, so a single reviewed change describes every environment it targets.

## Antipatterns

Provisioning by hand and writing the definition afterward produces code that claims to describe the environment while quietly diverging from it, which is tempting because the manual path is faster the first time and the divergence stays invisible until the definition is applied and silently reverts something a person changed deliberately. Applying infrastructure changes straight from a contributor's machine, with no rendered plan and no record, hides both what changed and who changed it, and it feels safe precisely because the changes applied that way almost always work, right until the one that replaces a resource holding data. Keeping a plan step that runs but whose output nobody reads, or that is never attached to the change under review, satisfies the letter of a preview while giving no reader the chance to catch the destructive line.

## Check contract

A check proves the infrastructure definition synthesizes or plans successfully from a clean checkout, and that a preview command exists in the automation entry points.

## Waiver policy

Waivable with a declared waiver carrying owner and expiry of at most 90 days, except where noted.
