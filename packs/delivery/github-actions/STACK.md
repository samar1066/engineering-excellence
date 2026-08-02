---
title: github-actions golden path
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-02
updated: 2026-08-02
---

# github-actions golden path

## Purpose

This is the golden path for the delivery pipeline of a repository built from
this program: read it before editing anything under `.github/`. It is written
for the AI coding agent or engineer who has just opened a composed repository
and needs to know what gates a change, what ships it, and which of the two
files in `.github/workflows` to touch for which reason.

This pack is a delivery pack, not a stack pack. It claims no component
directory and writes no application code. What it contributes is repository
level: the workflow that runs every component's own gate, and the workflow
that takes one built image through dev, then uat, then production. Both files
exist in `scaffold/.github/workflows/`, and everything below describes files
that are already there.

Two facts shape everything else. GitHub reads workflows only from
`.github/workflows` at the repository root, so a workflow inside a component
directory never runs, whatever it says. And an approval that lives in the same
repository as the code it guards can be edited by the change it is guarding,
so every approval in this pipeline lives in repository settings instead.

## The two workflows

`ci.yml` is the gate. It fires on every pull request and on every push to
every branch. It has one job per component, plus a `gate` job that aggregates
them:

| Job | Present when | Runs |
|-----|--------------|------|
| `backend` | `backend/Makefile` exists | `uv sync`, then `make test` |
| `service` | `service/package.json` exists | `npm ci`, then `npm run test:cov` |
| `frontend` | `frontend/package.json` exists | `npm ci`, then `npm run test:cov` and `npm run test:a11y` |
| `infra` | `infra/cdk.json` exists | `npm ci`, then `npm test` and `npm run synth` |
| `gate` | always | every component result was a success or a skip |

Each job runs the component's own gate command rather than a copy of it, so
what passes locally passes here for the same reasons. Each job checks the
repository out and then guards its real steps with `hashFiles`, which is what
lets a repository composed from only some packs pass on the components it
actually has.

The guard belongs on the step and never on the job. A job level `if` is
evaluated before any runner has a workspace, so `hashFiles` can only return an
empty string there, every job would skip, and the whole gate would report
green while verifying nothing. This is the single most dangerous edit
available in this file.

`gate` is the job to require in a branch protection rule. It runs with
`always()` and inspects each result, because a job that merely lists its
dependencies is itself skipped when any dependency is skipped, and a skipped
status check is not a passing one.

`deploy.yml` is the pipeline. It has four jobs in one chain: `build`, then
`deploy-dev`, then `deploy-uat`, then `deploy-prod`. It fires on a push to the
default branch and on `workflow_dispatch`, which takes an optional `imageTag`
input naming an existing image to promote again. It declares
`permissions: id-token: write` and `contents: read`, which is what lets it
federate to AWS with no stored credential and nothing more.

## The promotion contract

One image, three deployments, two approvals. In detail:

The `build` job resolves a tag, and the tag is the commit sha unless a
dispatch named an existing one. A sha is immutable and names exactly one
source revision, which is the property the whole contract rests on. The tag is
checked against the character set an image tag may use before it is written to
the job output, so a dispatch input can never be read as shell.

`build` pushes to ECR and publishes `image-tag` as a job output. No other job
runs `docker build`. When a dispatch named an existing tag, even the build
step is skipped, because rebuilding over a tag would replace the bytes uat
approved with different ones under the same name.

The tag then travels the chain. GitHub exposes a job's outputs only to its
direct dependents, so `deploy-dev` re-exports `needs.build.outputs.image-tag`
unchanged, `deploy-uat` re-exports what `deploy-dev` gave it, and
`deploy-prod` deploys what `deploy-uat` gave it. Every hop is a verbatim
expression: no recomputation, no default, no fallback to a branch name. Each
stage hands it to the CDK application as `--context imageTag=...`.

Ordering and approval are two mechanisms and both are present. The `needs`
chain makes production unreachable until uat has succeeded. The `environment:`
key on each deploy job is what a person can stand in front of: attach required
reviewers to `uat` and to `production` in repository settings, and each of
those stages waits for a human before it starts.

What legitimately differs between environments arrives as configuration. The
stack name differs (`-dev`, `-uat`, `-prod`), the environment scoped variables
may differ, and everything else about the artifact is identical by
construction.

## Branch freedom

The pipeline binds to environments, not to branches. Nothing in this pack
requires trunk based development, GitFlow, release branches, or any other
model; the only place a branch name appears at all is the push trigger of
`deploy.yml`, and it is there so that a merge ships something rather than
because the name matters.

To change it, edit that one `branches:` list. Rename `main` to `trunk` or
`develop`, list several branches, use a pattern such as `release/*`, or delete
the push trigger entirely and release only through `workflow_dispatch`. No
other line in either file changes, because no other line knows a branch name
exists. `ci.yml` already runs on every branch, so the gate is unaffected by
any of these choices.

What the program does require is that at least one production and one non
production environment exist, and that the production one is reached last.
That is a statement about environments, which are named in repository
settings, and it stays true under every branching model.

## Configuring the AWS side

None of this lives in the repository. `templates/config/environments.md`
walks through it in order, with placeholders only; the summary:

1. Create three GitHub environments named `dev`, `uat`, and `production`, and
   attach required reviewers to the last two.
2. Create an IAM OpenID Connect identity provider for
   `token.actions.githubusercontent.com` with audience `sts.amazonaws.com`,
   once per AWS account.
3. Create a deployment role whose trust policy admits this repository's
   subject through that provider, narrowed with a `sub` condition, and grant
   it ECR push plus the CloudFormation permissions the CDK deployment needs
   and nothing else.
4. Set the repository variables `AWS_ROLE_ARN`, `AWS_REGION`, and
   `ECR_REPOSITORY`. No secret is needed, because OIDC leaves nothing to
   store. An environment may override the first two, so one account per stage
   is a variables change rather than a workflow edit.

A role per environment is better than one role that can reach every account,
and an environment scoped `sub` condition is the tightest form of the trust
policy.

## How it composes

This pack is designed to be one of several in a repository, and it shares
exactly two contracts with its neighbours.

With the aws-cdk pack: the context key `imageTag`. Every deploy job passes
`--context imageTag=<tag>` to `npx cdk deploy` from the `infra` directory, and
the CDK application reads that context to decide which image its service runs.
Stack names follow `<project>-dev`, `<project>-uat`, and `<project>-prod`,
rendered from the project name at `eep init`. If a stack is renamed, the three
deploy steps are what changes.

With the containers pack: the path `docker/backend.Dockerfile`. The build job
builds that file with the repository root as its context. A repository that
ships more than one image adds a build step per image and a tag per image,
keeping one build job so the artifacts stay siblings of one run.

With the stack packs: the marker files in the table above, and each
component's own gate command. A stack pack's own `ci.yml`, scaffolded inside
its component directory, is what its own EEP-DLV-01 check reads; it does not
run on GitHub and is not a second gate.

## What verify checks here

This pack declares no `workdir`, so both of its checks resolve from the
repository root, which is where the workflows GitHub reads have to live. Both
are builtin, so they run through `eep verify` rather than as commands you can
type:

| Law | Kind | Command |
|-----|------|---------|
| EEP-DLV-01 | builtin | `file-contains-any .github/workflows 'eep verify'` |
| EEP-DLV-03 | builtin | `file-contains .github/workflows/deploy.yml 'needs: deploy-uat'` |

Both are presence checks, and both are honest about it. The first proves
continuous integration is wired to the gate, not that every check inside it
passes today. The second proves the one edge in the job graph that makes
production unreachable before uat, so deleting it fails the gate in the same
change that broke the promotion order rather than a release later. What the
checks cannot see, and a reviewer therefore holds, is that no second
production path was added elsewhere in the file, and that no hop in the tag
chain recomputes what it was handed.

Twelve laws are declined by this pack rather than implemented, with reasons
recorded in `pack.yaml` and summarized in the pack README. They are the stack
scoped and corpus scoped ones: a pack that ships two workflow files has no
layers, no suite, no lockfile, and no documents of its own, and each of those
laws is implemented by the component packs whose components this pipeline
gates and deploys.

## When you deviate

The golden path is the default, not a cage. When a rule genuinely does not
fit, declare a waiver in `.eep/waivers.yaml` naming the law ID, an owner, and
an expiry date, with a sentence on why. Never suppress a check inline, and in
this pack that means something specific: a `continue-on-error` on a gate step,
an `if` that quietly excludes a component, or a second job that reaches
production outside the chain are all suppressions wearing workflow syntax.
Each of them leaves the file green while removing the guarantee the file
exists to provide. A waiver keeps the deviation visible, owned, and temporary;
when the expiry arrives, fix the pipeline or renew the waiver deliberately.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
