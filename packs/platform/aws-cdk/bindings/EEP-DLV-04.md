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

## How this stack satisfies it

`lib/environments.ts` holds a table of three stages, `dev`, `uat`, and `prod`,
and each one instantiates the same `ServiceStack` into its own CloudFormation
stack, named `<project>-<stage>`. Because they come from one parameterized
definition, the stages differ in scale and retention rather than in shape: dev
runs one task, uat runs two, prod runs three behind a load balancer it also
protects from deletion, and each stage builds its own VPC, its own cluster, its
own log group, and its own security groups. No resource is shared between them,
so a change applied to uat cannot exhaust a quota or sever a network path that
prod depends on. Isolation goes one level further than the stack boundary: the
account and the region are not written into the table at all, they bind at
deploy time from `CDK_DEFAULT_ACCOUNT` and `CDK_DEFAULT_REGION`, which the CDK
CLI exports from whichever credentials the deploy runs under. A pipeline that
holds a separate role per stage therefore lands each stage in a separate
account with no change to this repository, and the same definition still
synthesizes with no credentials at all. Adding a fourth stage is one entry in
the table.

## The check

`file-contains lib/environments.ts uat` (see checks/manifest.yaml) is a builtin
check that confirms the stage table names a stage other than production; it
proves a non production environment is declared, not that it is deployed or that
it is genuinely isolated once deployed. It is a fast static check over the one
file that decides how many environments exist, which is what makes it hard to
satisfy by accident: deleting the non production stage from the table is the
exact change that fails it. The deeper guarantees, one stack per stage, no
shared resources, and account binding at deploy time, are covered by the
template assertions in `test/service-stack.test.ts`, including one that fails
when dev and prod render the same desired count, which is what a stack that
ignored its stage parameter would produce.

## Notes for agents

Add a stage by adding an entry to `environments` in `lib/environments.ts` and
nothing else: `bin/app.ts` instantiates whatever the table contains, so a new
stage arrives with its own stack, its own network, and its own logs. Never point
a non production stage at a production resource to get realistic data, and never
run two stages inside one stack to save on cost, because both trade the
isolation this law exists to keep for a saving that a single incident erases.
When a stage needs a value the others do not, add the field to
`EnvironmentConfig` and give every stage a value for it, instead of reading the
stage name at the point of use; the type then makes an unconsidered stage a
compile error rather than a runtime surprise. Keep production behavior attached
to the `isProduction` flag rather than to a string comparison, so a renamed stage
cannot silently acquire production behavior or lose it.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
