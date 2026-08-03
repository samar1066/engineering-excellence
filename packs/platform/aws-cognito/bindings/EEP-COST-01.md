---
title: EEP-COST-01 binding
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-03
updated: 2026-08-03
---

## How this pack satisfies it

The user pool is a provisioned resource that accrues cost and outlives the memory of why it was created, so the construct in `construct/user-pool.ts` labels it with an owner and an environment as part of the same declaration that creates it. Both values are passed in by the stage that instantiates the pool rather than typed into the construct, so every resource in a deployment inherits a consistent owner and environment and a report can group the whole estate by either one. Cognito renders these as entries in a `UserPoolTags` map rather than the standard resource tag array, so the attribution is carried on the pool in the shape Cognito expects, applied where the pool is declared so the label cannot drift from the thing it describes. The aws-cdk stack that composes this construct passes its own project and stage through as the owner and environment, so the pool is attributed the same way as every other resource in the stage.

## The check

`npm run test:construct -- -t "tags the user pool"` (see `checks/manifest.yaml`) synthesizes the construct into a CloudFormation template with vitest and the aws-cdk-lib assertions module, then asserts that the pool's `UserPoolTags` map carries both an `Owner` and an `Environment` key with the values the stage supplied. A companion assertion synthesizes the pool with different values and confirms the tags track the input rather than a hard coded default. It needs no AWS credentials and reaches no AWS account, so a report built on these tags is attributing the resource that actually deploys.

## Notes for agents

When you compose this pool into a stack, pass the stage's own owner and environment into the construct so the pool joins the rest of the estate under one attribution scheme rather than a scheme of its own. If you add a second pool for another audience, tag it the same way and add the same assertion, because one untagged resource is enough to make a bill only partially attributable and therefore not attributable at all. Keep the tags on the construct rather than applying them by hand after the fact, so the label is created with the resource and cannot be forgotten.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-03*
