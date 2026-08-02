---
title: EEP-DLV-03 binding
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-02
updated: 2026-08-02
---

## How this pack satisfies it

`scaffold/.github/workflows/deploy.yml` has exactly one job that builds an
image and three that deploy one. The `build` job resolves a tag, which is the
commit sha unless a dispatch named an existing tag to promote, pushes the
image to ECR under it, and publishes it as the job output `image-tag`. No
later job runs `docker build`. There is no second path into the file that
produces an artifact, so the bytes production serves are the bytes dev
received.

The four jobs form a single chain, each depending on the one before it:
`build`, then `deploy-dev`, then `deploy-uat`, then `deploy-prod`. GitHub
exposes a job's outputs only to its direct dependents, so the tag is
forwarded hop by hop: `deploy-dev` re-exports `needs.build.outputs.image-tag`
unchanged, `deploy-uat` re-exports what `deploy-dev` gave it, and
`deploy-prod` deploys what `deploy-uat` gave it. Every forward is a verbatim
expression with no recomputation, no default, and no fallback to a branch
name, so the reference the production stack receives is provably the one the
build job wrote. Each stage passes it to the CDK application as
`--context imageTag=...`, which is the one contract this pack and the aws-cdk
pack share.

Ordering and approval are separate mechanisms and both are present. The
`needs` chain is what makes production unreachable before uat has succeeded;
the `environment:` key on each deploy job is what lets a person stand in
front of a stage. Required reviewers are attached to the uat and production
environments in repository settings rather than declared in the file, which
is deliberate: an approval that can be edited in the same pull request as the
code it guards is not an approval. A dispatch may name an existing tag to
re-promote, and even then the chain is unchanged, so a hotfix rehearses in
dev and uat exactly like every other release.

## The check

`file-contains .github/workflows/deploy.yml 'needs: deploy-uat'` (see
checks/manifest.yaml) reads the deployment workflow at the repository root
and proves the production job's dependency line is present, which is the
structural fact that makes a production deployment impossible until the non
production one has succeeded. It is a single literal because the guarantee is
a single edge in the job graph: delete it and the check fails in the same
change that broke the promotion order, rather than a release later. It is a
presence check and not a proof of the whole law: that no other production
path exists, and that the tag forwarded down the chain is never recomputed,
are properties this pack's STACK.md states and a reviewer holds.

## Notes for agents

If this check fails, the production job no longer waits on uat, and the fix
is to restore the dependency, never to relax the check. Resist three edits in
particular. Do not add a job that deploys production from anywhere else in
the file, whatever it is called and however urgent the reason; an emergency
route added once becomes the ordinary route. Do not replace a forwarded
`needs.<job>.outputs.image-tag` with a fresh expression, a branch name, or a
`latest` tag, because two runs of the same declared version would then be two
different artifacts. Do not add a `docker build` to a deploy job to pick up a
late fix; build a new image through the whole chain instead. When you add a
stage, insert it into the chain and forward the tag through it the same way
every existing stage does, and when you add an environment, attach its
reviewers in repository settings rather than encoding an approval here.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
