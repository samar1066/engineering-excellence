---
title: github-actions
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-02
updated: 2026-08-02
---

# github-actions

A Tier 1 delivery pack that binds the Engineering Excellence Program, program version 0.2.0, to GitHub Actions as the continuous integration and promotion pipeline of a repository. A repository matches this pack when `.github/workflows/deploy.yml` exists. Unlike a stack pack it claims no component directory and writes no application code: it contributes the two repository level workflows that gate every change and that promote one built image through dev, then uat, then production on AWS, federating with OpenID Connect so no long lived credential is ever stored.

## What this pack gives you

- `STACK.md`: the golden path an AI coding agent reads before editing anything under `.github/`.
- A root placed scaffold under `scaffold/.github/workflows/` with two files and nothing else: `ci.yml`, one gate job per component plus an aggregating `gate` job, and `deploy.yml`, a build once and promote three times pipeline with approvals at uat and production.
- `templates/config/environments.md`: the ordered setup note for the three GitHub environments, their required reviewers, and the AWS OIDC identity provider and deployment role, with placeholders only.
- Executable checks in `checks/manifest.yaml` that map each implemented law to the command proving it.
- Bindings that explain the promotion contract the workflows encode, and the three edits most likely to break it.

## Laws implemented

This pack implements two laws:

- EEP-DLV-01
- EEP-DLV-03

The how and the why for each law in this pack live in `bindings/<LAW-ID>.md`, one file per law above.

It declines twelve laws, each with a recorded reason: EEP-ARCH-01, EEP-TEST-01, EEP-TEST-03, EEP-SEC-01, EEP-SEC-02, EEP-OBS-01, EEP-OBS-02, EEP-DLV-02, EEP-DOCS-01, EEP-DOCS-02, EEP-DOCS-03, and EEP-DEVX-01. Eleven are stack scoped and belong to the component packs whose components this pipeline gates and deploys, and one, EEP-DOCS-03, is corpus scoped.

## Blessed toolchain

GitHub Actions with OIDC to AWS is now declared in `pack.yaml` as the ci entry. GitHub environments, Amazon ECR, and the AWS CDK CLI remain documented only here and in `STACK.md`. What `pack.yaml` does carry is the list of categories this pack declines and why.

| Tool | Config | Rationale |
|------|--------|-----------|
| GitHub Actions hosted runners | scaffold/.github/workflows/ci.yml | The gate runs where the code already is, with no runner fleet to operate. |
| GitHub environments | templates/config/environments.md | Approvals live in repository settings, so a change cannot edit the approval that guards it. |
| OpenID Connect federation to AWS | scaffold/.github/workflows/deploy.yml | A deployment role is assumed per run, so there is no long lived access key to store, rotate, or leak. |
| Amazon ECR | scaffold/.github/workflows/deploy.yml | Holds the one image the pipeline promotes, addressed by an immutable commit sha tag. |
| AWS CDK CLI | scaffold/.github/workflows/deploy.yml | Applies the same infrastructure definition per stage, parameterized only by stack name and image tag. |

## Standalone use

Copy this folder plus CONSTITUTION.md into any repository and point your agent at STACK.md; the eep CLI is an accelerator, not a requirement. The scaffold is the deliverable: copy `scaffold/.github/` to your repository root, substitute the `{{project_name}}` token in `deploy.yml` for your CDK stack prefix, and follow `templates/config/environments.md` to create the environments, the OIDC provider, the deployment role, and the three variables. Both of this pack's checks are builtin, so they run only through `eep verify`; without the CLI they read as two statements a reviewer can confirm by eye in under a minute, which is why the manifest states them as literal file contents rather than as scripts. The workflows themselves need nothing installed locally: GitHub runs them, and the component gates they invoke are each component's own commands.

## Related

- Law IDs: EEP-DLV-01, EEP-DLV-03; declined: EEP-ARCH-01, EEP-TEST-01, EEP-TEST-03, EEP-SEC-01, EEP-SEC-02, EEP-OBS-01, EEP-OBS-02, EEP-DLV-02, EEP-DOCS-01, EEP-DOCS-02, EEP-DOCS-03, EEP-DEVX-01.
- Packs: none required. It composes with `python-fastapi`, `typescript-node`, `react`, `aws-cdk`, and `containers-k8s`, and shares two contracts with them: the `imageTag` CDK context key and the `docker/backend.Dockerfile` path.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
