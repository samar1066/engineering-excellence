---
title: aws-serverless golden path
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-02
updated: 2026-08-02
---

# aws-serverless golden path

## Purpose

This is the golden path for the serverless infrastructure component built from the aws-serverless pack: read it before changing anything under `infra-serverless/`. It is written for the AI coding agent or engineer who has just opened the repository and needs to know where infrastructure code goes, what the verification gate will demand of it, and how a change reaches production. Every path and command below exists in this pack's scaffold, so copy the working pattern instead of inventing a new one.

The component is a CDK v2 application in TypeScript that deploys one HTTP API on Amazon API Gateway backed by AWS Lambda, instantiated once per environment: `dev`, `uat`, and `prod`.

## When to choose this path

This pack is the serverless alternative to the aws-cdk pack's Fargate path. Both declare AWS infrastructure with CDK v2 in TypeScript, and they differ only in what runs the code.

Choose serverless when request volume is spiky, low, or unpredictable, when a unit of work finishes well inside the fifteen minute Lambda limit, when you want capacity to be somebody else's problem, and when cost should follow requests rather than hours. Choose the Fargate path when the workload is a long lived server with steady traffic, holds connections open (websockets, server sent events, long polling), starts slowly or carries a large runtime, needs more than fifteen minutes for one unit of work, or benefits from running the identical container image locally and in production.

The two are not exclusive. A repository may adopt both: the aws-cdk pack lands in `infra/` and this pack lands in `infra-serverless/`, so a composed project can run its main API on Fargate while event driven or bursty endpoints run on Lambda. Composed init refuses only when two packs claim the same component directory, which these two never do. `eep verify` then runs each pack's checks from its own workdir and reports both.

The two differ in one detail worth stating rather than discovering: this component is native ESM (`"type": "module"`, `module` and `moduleResolution` both `nodenext`, relative imports carrying the `.js` extension), while the aws-cdk sibling ships a `node16` CommonJS style configuration. Both compose in one repository because each component installs its own dependencies and compiles independently, with no shared `tsconfig.json` and no shared `node_modules`. Aligning the two is queued; until then, copy import style from the component you are editing rather than from the other one.

## Anatomy

```
infra-serverless/
  bin/app.ts             one ApiStack per environment; account and region bind at deploy time
  lib/environments.ts    dev, uat, prod, and every value that differs between them
  lib/api-stack.ts       the HTTP API, the function, its log group, and the stack outputs
  test/api-stack.test.ts assertions over the synthesized CloudFormation template
  cdk.json               entry point the CDK CLI runs (npx tsx bin/app.ts)
  package.json           the five scripts: synth, diff, test, lint, build
  Makefile               setup, test, synth, verify
```

Three rules keep this shape intact.

Environments are data, never code. Anything that differs between stages is a field on the `Environment` type in `lib/environments.ts`, and every stage is one entry in the exported list. A stage difference expressed as a branch inside the stack (`if (stage === "prod")`) hides the difference from the one file a reviewer reads to find it. Branch on a named field such as `isProduction` instead.

One template, many instantiations. `lib/api-stack.ts` describes the shape of every environment exactly once, and `bin/app.ts` builds it once per entry. Adding a fourth stage is a one line change, and a copied stack file is the antipattern this shape exists to prevent.

Accounts bind at deploy time. `bin/app.ts` passes `CDK_DEFAULT_ACCOUNT` and `CDK_DEFAULT_REGION`, which the CDK CLI fills from whatever credentials the command runs under. No account id ever enters version control, and `npm run synth` works on a machine with no credentials at all, which is exactly what the verification gate needs.

## The handler is the backend's container image

The function runs a container image, not a bundle of handler code that lives in this component. `lib/api-stack.ts` references the image by ECR repository and tag through `IMAGE_REPOSITORY`, `IMAGE_TAG_CONTEXT_KEY`, and `UNDEPLOYABLE_IMAGE_TAG`, exactly the way the Fargate `service-stack.ts` references its image by registry and tag. The image's own CMD is the handler, so the backend the stack pack scaffolds runs here unchanged: there is no separate handler file in this component, no ASGI adapter to wire into the stack, and no second copy of the application to keep in step.

Referencing the image rather than building it as a CDK asset is deliberate, and it is what keeps the gate honest: with no bundler, no Docker daemon, and no network in the synth path, `npm run synth` renders the same templates from a clean checkout on any machine, and one image built once is promoted by tag through dev, uat, and prod. When no `imageTag` context is supplied the stack falls back to `UNDEPLOYABLE_IMAGE_TAG`, a tag no build ever pushes, which makes a template synthesized without one impossible to deploy into a running function by accident. The gate's `npm run synth` passes a harmless placeholder, `--context imageTag=ci-validation`, exactly as the Fargate sibling does, and a real deploy names the built artifact: `npx cdk deploy --all -c stage=dev --context imageTag=<sha>`.

Every route reaches this one function. The HTTP API is created with a `defaultIntegration`, which renders a single `$default` route, so the application behind the gateway owns its own routing and a new endpoint is a change to the backend rather than a new route in this stack.

One thing the image owes that a plain server image does not. A Lambda container image must speak the Lambda Runtime API, while the backend's Dockerfile from the containers-k8s pack runs uvicorn as a long lived server on a port. Making the same image serve both is a change to the image build, owned by the container pack and the delivery pipeline rather than by this stack, and there are two clean shapes for it:

1. Put the AWS Lambda Web Adapter in front of the existing server. The image keeps its uvicorn CMD and exposes its port, and the adapter, added as a layer or copied in as an extension, translates each Lambda invocation into an HTTP request to it. The application code does not change at all.
2. Build a Lambda flavored image from an AWS base image for Python and set its CMD to an ASGI handler such as Mangum wrapping `app.main:app`. This is a second, small Dockerfile beside the server one rather than an edit to the application.

Either way the choice lives in the image, so this stack is unaffected: it references whatever image the pipeline publishes under the repository and tag, and its template is identical regardless of which shape the image takes.

Logging and tracing follow the same seam. The function turns on X-Ray active tracing and provisions its log group and retention here, but the shape of a log line and the propagation of a span live inside the container image, which is the backend component's concern. The structured logging and trace context the backend already configures reach CloudWatch and X-Ray through the log group and the active tracing this stack sets up, with nothing to add in TypeScript.

## Toolchain

The blessed tools. Do not substitute alternatives without a waiver.

| Category | Tool | Command |
|----------|------|---------|
| Package manager | npm | `npm ci` |
| Infrastructure language | CDK v2 with aws-cdk-lib on TypeScript | `npx cdk` |
| Formatter | biome format | `npx biome format --write bin lib test` |
| Linter | biome | `npm run lint` |
| Type checker | tsc --noEmit | `npm run build` |
| Unit tests | vitest with the aws-cdk-lib assertions module | `npm test` |
| Integration tests | cdk synth over every stage | `npm run synth` |
| E2E tests | cdk deploy into a sandbox account, then a request against ApiUrl | run against an account, not in this scaffold |
| Logging | aws-lambda-powertools logger | inside handlers, see above |
| Tracing | X-Ray active tracing with the aws-lambda-powertools tracer | `tracing: Tracing.ACTIVE` in `lib/api-stack.ts` |

Daily work drives through four commands:

1. `make setup`: installs dependencies from the committed lockfile with `npm ci`.
2. `make test`: asserts against the synthesized template. No credentials, no network.
3. `make synth`: renders every stage into `cdk.out/`. This is the EEP-IAC-01 check.
4. `make verify`: runs the full gate through the eep CLI, every check in the table below.

While iterating, `npx vitest test/api-stack.test.ts -t "memory"` runs one assertion, and `npx cdk synth <app>-prod` prints one stage's template to read it by eye.

## Promotion contract

One artifact reaches production, and it is the cloud assembly: the `cdk.out/` directory a single `npm run synth` produced from one commit, holding one CloudFormation template per stage plus every asset those templates reference.

1. Synthesize once, in continuous integration, with no AWS credentials in the job. That is deliberate twice over: it is the EEP-IAC-01 check, and a credential free synthesis produces environment agnostic templates, which are the only ones that can be deployed into three different accounts. Upload `cdk.out/` as the build artifact of that commit.
2. Deploy that same artifact to dev: download `cdk.out/`, assume the dev account role, and run `npx cdk deploy --app cdk.out <app>-dev --require-approval never`. The `--app cdk.out` flag is what makes this a deployment of the artifact rather than a fresh synthesis, so what reaches dev is byte for byte what verification passed.
3. Deploy the same artifact to uat behind an environment approval, then to prod behind its own approval, changing only the stack name and the role assumed. A stage that is skipped is a stage that never rehearsed.

One honest caveat about who runs those three steps. The github-actions delivery pack this program ships automates the container and Fargate path today: its `deploy.yml` builds an image once and promotes that image tag through dev, uat, and prod. The cloud assembly promotion described above is documented here as the contract a pipeline for this component must implement, and generating that workflow is queued for a later revision of the delivery pack. Until it lands, the three steps are yours to write, and this section is the specification to write them against.

Two supporting rules. When synthesis and deployment happen in one step, which is the local and manual path, always name the stage as context: `npx cdk deploy --all -c stage=uat` builds only that stage's stack, so the command cannot reach an environment nobody asked for. And run `npm run diff` before any deployment to a stage that already exists, attaching its output to the change under review: `cdk diff` reads deployed state and names every resource that would be created, replaced, or destroyed, which is the difference between an approval and a guess.

## What verify checks here

`make verify` runs the checks in `checks/manifest.yaml` from this component's directory:

| Law | Kind | Command |
|-----|------|---------|
| EEP-IAC-01 | shell | `npm run synth` |
| EEP-DLV-04 | builtin | `file-contains lib/environments.ts uat` |

The synth check has teeth because of one line in `cdk.json`: the `@aws-cdk/core:validateAgainstDefaultRules` feature flag turns CloudFormation's own property validation from warnings into synthesis errors, so a memory size below the minimum or a malformed property fails the gate instead of printing a warning nobody reads and then failing a deployment. Leave it on.

This pack implements those two laws and declines the thirteen stack scoped laws with a reason recorded in `pack.yaml` for each. That is not a gap in a composed repository: the application component's pack proves architecture, tests, secrets, logging, and documentation over the code it owns, and the delivery pack proves the CI gate and the promotion sequence, so every law still has exactly one owner. In a repository that adopts this pack alone, read those thirteen reasons as a list of what is not being proved here.

## When you deviate

The golden path is the default, not a cage. When a rule genuinely does not fit, declare a waiver in `.eep/waivers.yaml` naming the law ID, an owner, and an expiry date, with a sentence on why. Never silence a check in place: a stage quietly dropped from `lib/environments.ts`, a synth failure worked around by pinning an account id, or a `cdk deploy` run from a laptop instead of the pipeline are all deviations that leave no record. A waiver keeps the deviation visible, owned, and expiring, and when the expiry arrives you either fix the cause or renew it deliberately.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
