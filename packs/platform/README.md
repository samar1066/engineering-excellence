---
title: Platform packs
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-02
updated: 2026-08-02
---

# Platform packs

This folder holds every pack of kind `platform`: the packs that bind laws to infrastructure and runtime surfaces rather than to a language or framework, loaded by the CLI's detect step when a consumer repository matches one of their detect rules. A platform pack augments a repository rather than scaffolding an application: it adds an infrastructure definition, a container build, or a deployment target alongside the components a stack pack already scaffolded, rather than generating an application of its own.

## Overview

A platform pack owns one infrastructure or runtime surface end to end: a blessed toolchain, an executable check for every law it implements, and a recorded reason for every law it declines because that law is scoped to the components it runs rather than to the infrastructure itself. Detection is declarative, the same as any pack kind: a platform pack lists the file that identifies its surface, such as `infra/cdk.json` for a CDK deployment or `docker-compose.dev.yaml` for a container build, so the CLI activates it without a human choosing infrastructure by hand. The corpus ships three platform packs today: `aws-cdk` and `aws-serverless` each declare an AWS CDK v2 deployment, one for a containerized service on Fargate and one for a serverless HTTP API on Lambda, while `containers-k8s` builds the per component image definitions and local compose loop that a Fargate deployment consumes.

## Contents

<!-- eep:index -->
- `containers-k8s/`: binds EEP-IAC-02 to per component image definitions and the docker compose loop that starts the composed system, augmenting whatever the stack packs scaffold.
- `aws-cdk/`: binds EEP-IAC-01 and EEP-DLV-04 to an AWS CDK v2 deployment that runs a containerized service on Fargate across dev, uat, and prod.
- `aws-serverless/`: binds the same two laws to an AWS CDK v2 deployment of an HTTP API on API Gateway and Lambda, the serverless alternative to aws-cdk.
<!-- /eep:index -->

## Related

Pack names: `containers-k8s`, `aws-cdk`, `aws-serverless`. Law IDs implemented: EEP-IAC-01, EEP-IAC-02, EEP-DLV-04. Law IDs declined: EEP-DLV-01, EEP-DLV-02.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
