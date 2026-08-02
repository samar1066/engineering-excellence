---
title: aws-cdk golden path
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-02
updated: 2026-08-02
---

# aws-cdk golden path

## Purpose

This is the golden path for the infrastructure of a project built from the aws-cdk pack: read it before changing anything under `infra/`. It is written for the AI coding agent or engineer who has just opened the repository and needs to know where a resource goes, how a stage is added, what a deploy actually promotes, and what the verification gate will demand. Every path and command below exists in this pack's scaffold, so copy working patterns from it instead of inventing new ones.

The pack deploys one containerized service to AWS Fargate behind an application load balancer, in three stages. It is deliberately one service and three stages rather than a general purpose landing zone: an infrastructure definition earns its keep by being small enough that a reader can hold all of it at once, and everything else this program needs, the image itself and the pipeline that promotes it, belongs to the container and delivery packs.

## Project shape

The whole application is four files. One line per file, one responsibility each:

```
infra/
  cdk.json           the CDK entry point: runs bin/app.ts, and pins the feature flags
  bin/
    app.ts           instantiates one ServiceStack per stage in the table, and names each stack
  lib/
    environments.ts  the stage table: the only place a stage is declared
    service-stack.ts the single stack every stage instantiates
  test/
    service-stack.test.ts  synthesizes each stage and asserts on the rendered template
  Makefile           the four entry points: setup, test, synth, verify
  package.json       scripts and dependencies, pinned by package-lock.json
```

Two rules keep that shape. Nothing under `lib/` reads an environment variable or a stage name to decide what to build: every difference between stages arrives as a field on `EnvironmentConfig`. And `bin/app.ts` contains no resources, only the loop that instantiates them, so the stack file stays the one place a reader has to look to know what runs.

## The stage model

`lib/environments.ts` declares three stages, and the record it exports is the whole model:

| Stage | isProduction | Desired count | CPU | Memory | NAT gateways |
|-------|--------------|---------------|-----|--------|--------------|
| dev | false | 1 | 256 | 512 | 0 |
| uat | false | 2 | 512 | 1024 | 0 |
| prod | true | 3 | 1024 | 2048 | 2 |

Each entry becomes one CloudFormation stack named `<project>-<stage>`, holding its own VPC, cluster, service, load balancer, log group, and security groups. Nothing is shared across stages, so a change to uat cannot reach prod through a resource they both use.

Production behavior hangs off the `isProduction` flag rather than off a comparison against the string `prod`, so renaming a stage cannot silently grant it production behavior or take it away. Today that flag decides four things: whether tasks run in private subnets behind NAT gateways, whether the load balancer carries deletion protection, how long logs are retained and whether the log group survives a stack deletion, and whether a rolling deployment is allowed to dip below full capacity.

Accounts and regions are absent from the table on purpose. They bind at deploy time from the standard `CDK_DEFAULT_ACCOUNT` and `CDK_DEFAULT_REGION` variables, which the CDK CLI exports from whichever credentials the deploy runs under. Three consequences follow, and all three are the point:

1. `npm run synth` works from a clean checkout with no AWS credentials and no network access to an account, which is what lets it be a gate that runs on every change.
2. A pipeline that assumes a different role per stage lands each stage in a different account with no change to this repository.
3. A stack synthesized without credentials is environment agnostic, which is why the network is capped at two availability zones: an account agnostic template can name two zones symbolically and no more.

The same command behaves differently once credentials are present, and both behaviors are correct. With credentials, the CLI binds the account and the region, the stack becomes environment specific, and the VPC looks the account's real availability zones up and caches them in `cdk.context.json`, which is committed like any other input. With no credentials, the stacks stay account agnostic and the zones render symbolically.

Adding a stage is one entry in the table plus one deploy. Never copy `service-stack.ts` to give a stage a different shape; add a field to `EnvironmentConfig` and give every stage a value for it, so the type system makes an unconsidered stage a compile error.

## Stack anatomy

`ServiceStack` builds the following, in this order, and the reasoning behind each choice is written beside it in the file:

1. A `Vpc` across two availability zones. Non production runs with no NAT gateway at all and places its tasks in public subnets with a public IP, because a NAT gateway bills per hour whether or not a task is running and is the largest idle cost in a small service. Production keeps its tasks in private subnets with one NAT gateway per zone.
2. An ECS `Cluster` on that VPC with Container Insights enabled in every stage, on the principle that a metric which only exists in production is a metric nobody has read before the incident that needs it.
3. A `LogGroup` whose retention and removal policy come from the stage: three months and retain in production, one week and destroy elsewhere.
4. An `ApplicationLoadBalancedFargateService` sized from the stage table, with the deployment circuit breaker enabled and rollback on, a health check grace period, and the log driver pointed at the log group above. The image is `ecs.ContainerImage.fromRegistry` over the placeholder repository named at the top of the file, tagged by the context parameter described in the next section.
5. A health check on the target group against `/health`, the endpoint every backend pack in this program serves, so the load balancer decides a task is alive the same way an operator would.
6. Deletion protection on the production load balancer only, because it is the resource holding the DNS name every client resolves.
7. `Project` and `Stage` tags across the stack, which is what makes a bill splittable by stage, and two outputs: the service URL and the image tag the stage was synthesized with.

The image repository is a placeholder. The first time this stack is deployed against a real account, replace `IMAGE_REPOSITORY` in `lib/service-stack.ts` with the real registry path, for example an ECR repository URI. That constant is the only line in the file expected to change on adoption.

## The promotion contract

The image tag is the artifact reference, and it arrives as a CDK context parameter rather than as a value in this repository:

```
npx cdk deploy {{project_name}}-dev  --context imageTag=<sha>
npx cdk deploy {{project_name}}-uat  --context imageTag=<sha>
npx cdk deploy {{project_name}}-prod --context imageTag=<sha>
```

The same `<sha>` runs in all three commands. That is the entire promotion contract with the delivery pack: the pipeline builds and pushes one image, tags it with the commit sha, and then deploys that one tag to dev, then to uat behind an approval, then to prod behind another. Nothing in `infra/` is edited between those three deploys, which is what makes the uat deployment evidence about the prod one rather than a rehearsal of a different change.

Two details make the contract hard to break by accident. First, when no `imageTag` is supplied the stack falls back to `UNDEPLOYABLE_IMAGE_TAG`, a tag no build ever pushes, so a deploy that forgot the parameter fails at the registry pull instead of quietly rolling a stage back to whatever `latest` happened to point at. Second, the tag is echoed as a stack output and as an `IMAGE_TAG` environment variable on the container, so what is running in a stage can be read from the stack rather than inferred from a pipeline log.

Stack names carry the project name, normalized: CloudFormation accepts letters, digits, and hyphens only, so an underscore in a project name becomes a hyphen in `stackName`. A project called `my_shop` deploys `my-shop-dev`, `my-shop-uat`, and `my-shop-prod`.

## Diff before deploy

A deploy is the one command in this repository that can destroy something no test can restore, so it is always preceded by a preview:

```
npm run diff -- {{project_name}}-prod --context imageTag=<sha>
```

Read the output rather than skimming it. Three things are worth stopping for: a resource marked for replacement, which means the existing one is destroyed and recreated; any change to a security group ingress rule; and any change to the load balancer or its listener, since that is the DNS name clients hold. A diff with the tag the deploy will actually use is the only diff worth reading, because the container image line is usually the change you intend and everything else on the list is the change you did not.

`npm run diff` needs AWS credentials and a deployed stack to compare against, so it is a discipline rather than a gate. The gate is `npm run synth`, which needs neither and therefore runs on every change.

## Cost notes

Performance and cost are features, and an infrastructure definition is where cost is decided. What this stack spends, and why:

1. NAT gateways are the largest idle cost in a small service, billed per hour plus per gigabyte, and non production runs with none. Tasks there sit in public subnets with a public IP, which is safe because their security group opens only the load balancer's path to the container port. Production pays for one per zone to keep its tasks off the public network.
2. The load balancer is the second standing cost and there is one per stage, which is the price of the isolation EEP-DLV-04 requires. A team that cannot carry three load balancers should reduce the number of stages rather than share one.
3. Task size and count come from the stage table, and non production is small on purpose. Raising a non production stage to production scale to reproduce a load problem is a legitimate temporary change to one line, and lowering it again is part of the same change.
4. Logs are the quiet cost. Retention is one week outside production, and the non production log group is destroyed with its stack, so a torn down stage leaves nothing billing behind.
5. The `Project` and `Stage` tags are what make all of this visible in a cost report split by stage, rather than a single number nobody can attribute.

## What verify checks here

`make verify` runs every check in `checks/manifest.yaml`, from the `infra` directory. The shell check is a plain command you can run by hand while iterating; the builtin check is implemented inside the eep CLI and runs only through `eep verify`, which `make verify` reaches with or without a local install:

| Law | Kind | Command |
|-----|------|---------|
| EEP-IAC-01 | shell | `npm run synth` |
| EEP-DLV-04 | builtin | `file-contains lib/environments.ts uat` |

Both rows deserve a note. `npm run synth` passes a placeholder image tag so the run is credential free and deterministic; it proves the definition evaluates and every stage renders, not that a deploy would succeed. It catches strictly more than `make test` does, because the CLI runs the CDK's own template validation afterwards: an impossible Fargate cpu and memory pair, for example, passes every assertion in the suite (they read the same table the stack read) and fails synth. The `file-contains` check proves a non production stage is declared, and the assertions in `test/service-stack.test.ts` carry the rest: one stack per stage, the circuit breaker on, the health check path, no NAT gateway outside production, deletion protection only in production, and a case that fails if dev and prod ever render the same desired count, which is what a stack ignoring its stage parameter would produce.

Thirteen laws are declined by this pack rather than implemented, because they are scoped to the service components this infrastructure deploys rather than to the infrastructure itself. The reasons are recorded one by one in `pack.yaml` and summarized in the pack README. The two that most often surprise a reader: this component ships a test suite and a Makefile while declining EEP-TEST-01 and EEP-DEVX-01, because those laws gate the repository's suite and its one command setup, both of which belong to the component packs.

## Toolchain

The blessed tools. Do not substitute alternatives without a waiver.

| Category | Tool | Command |
|----------|------|---------|
| Language | TypeScript strict | `npm run build` |
| Infrastructure library | aws-cdk-lib v2 with constructs | `npm run synth` |
| Package manager | npm | `npm ci` |
| Formatter | biome format | `npx biome format --write .` |
| Linter | biome | `npm run lint` |
| Type checker | tsc --noEmit | `npm run build` |
| Unit tests | vitest with aws-cdk-lib assertions | `make test` |
| Preview | cdk diff | `npm run diff -- <stack> --context imageTag=<sha>` |

Daily work drives through four commands:

1. `make setup`: installs dependencies with `npm ci`.
2. `make test`: synthesizes every stage in process and asserts on the templates.
3. `make synth`: renders every stage into `cdk.out`, credential free.
4. `make verify`: runs the full verification gate through the eep CLI.

`make verify` works for everyone: it runs the eep CLI when one is installed and otherwise falls back to `npx engineering-excellence verify`, so its only extra prerequisite is Node 22.

Tool configuration lives in the component directory (`tsconfig.json`, `biome.json`, `cdk.json`) and comes from the pack's blessed templates: edit it only with a waiver. The feature flags in `cdk.json` are the CDK's own current defaults, and they are pinned rather than curated: removing one silently changes what your constructs render.

## When you deviate

The golden path is the default, not a cage. When a rule genuinely does not fit, declare a waiver in `.eep/waivers.yaml` naming the law ID, an owner, and an expiry date, with a sentence on why. Never suppress a check inline (a biome-ignore, a ts-expect-error, a construct swapped for a raw Cfn resource to dodge a validation) without a matching waiver: inline suppressions hide deviations, while waivers keep them visible, owned, and temporary. When the expiry date arrives, fix the code or renew the waiver deliberately.

One deviation is worth naming in advance, because it is the common one. A team that needs a database, a queue, or a bucket should add it to `ServiceStack` with its own stage parameters, not to a second stack that a stage half depends on. The moment two stacks in one stage reference each other, deploy order becomes a thing people have to remember, and remembering is what this pack exists to avoid.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
