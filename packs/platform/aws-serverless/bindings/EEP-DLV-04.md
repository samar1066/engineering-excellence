---
title: EEP-DLV-04 binding
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-02
updated: 2026-08-02
---

## How this platform satisfies it

`lib/environments.ts` declares three stages, `dev`, `uat`, and `prod`, and
`bin/app.ts` turns each one into its own CloudFormation stack with its own name,
its own API, its own function, and its own log group. Nothing is shared between
them at runtime: two stacks never point at one resource, so a change applied in
dev cannot exhaust a quota or delete a log group that prod depends on. They are
instantiations of one template rather than three copies of a definition, so they
differ in scale and retention and not in shape, which is what makes a change
proven in uat genuine evidence about prod. The differences are deliberate and
visible in one file: prod runs on more memory, keeps its logs for six months
instead of one week, and retains its log group when the stack is deleted, while
the non production stages destroy theirs. Isolation of credentials comes from
the same place the account does, which is the deploy, not the file: each stage
deploys under its own assumed role, so a process running in dev holds no
credential that resolves to a prod resource. Adding a fourth stage is one entry
in the list, which keeps the number of environments a deployment decision.

## The check

`file-contains lib/environments.ts uat` (see checks/manifest.yaml) is a builtin
check that fails when the environment list no longer names the non production
stage that sits between dev and prod. It is deliberately the cheapest possible
proof of the shape this pack ships: the file is the single source of stages, and
a repository that has collapsed to one environment, or that has quietly deleted
the rehearsal stage to make a pipeline shorter, no longer contains that name.
Read alongside EEP-IAC-01's `npm run synth`, which fails if any stage in that
same file does not synthesize, the pair proves that at least two environments
are declared and that every one of them still builds.

## Notes for agents

Keep `lib/environments.ts` as the only place a stage is named. When a stage
needs a new dimension, add a field to the `Environment` type and read it in
`lib/api-stack.ts`, so every stage acquires the field and the stages stay one
template. Never branch on the stage string inside the stack (`if (stage ===
"prod")`); branch on a named boolean like `isProduction` instead, so the
intent is visible in the environment list rather than buried in construct code.
Never point a non production stage at a production resource to obtain realistic
data, and never delete or rename the uat entry to shorten a pipeline: the
promotion sequence and this check both stop meaning anything the moment the
rehearsal environment is gone.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
