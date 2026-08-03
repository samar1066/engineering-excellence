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

Both constructs apply an owner tag and an environment tag as part of the same declaration that creates the resources, so the label cannot drift away from what it describes. The uploads bucket tags itself, and the frontend hosting construct tags its whole subtree, so the site bucket and the distribution in front of it both carry the same two labels. Both values arrive as construct properties from the stage that instantiates them rather than being typed by hand per resource, so every resource a deployment provisions inherits a consistent owner and environment and a bill can be grouped by either one. Attribution is set where the resource is born, which is the only moment it is nearly free, rather than reconstructed later from a console when whoever created the resource may have moved on. Object storage and an idle distribution each cost little on their own, but they are still lines on a bill, and the tags are what let those lines be traced back to the team that can safely retire them.

## The check

`npm run test:construct -- -t "tags the uploads bucket with an owner and an environment"` (see `checks/manifest.yaml`) synthesizes the uploads bucket with vitest and the aws-cdk-lib assertions module and asserts that the rendered bucket carries both an owner tag and an environment tag with the values the stage passed in. It runs with no AWS account. This law is a warning rather than a blocking severity, so a missing tag is a governance gap to correct rather than a defect that halts a release, but the check is written so the gap is visible the moment it opens instead of during a spend review months later.

## Notes for agents

Set the owner and the environment from the shared stage definition, not as literals on a resource, so every resource in a deployment reads the same two values and none is left nameless. When you add a bucket or a distribution, pass it the same owner and environment and add the same assertion, because tagging only some resource kinds produces an estate that is partially attributable and therefore not attributable at all. Keep the tag keys identical to the ones the aws-cdk service stack already applies, so a cost report groups this storage and its edge beside the service they back rather than under a second spelling of the same idea.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-03*
