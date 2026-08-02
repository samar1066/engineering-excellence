---
title: EEP-IAC-01 binding
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-02
updated: 2026-08-02
---

## How this stack satisfies it

Every AWS resource this project runs on is a construct in `infra/lib/`, kept in
the same repository and the same pull request as the service that runs on it,
so a network change and the code that depends on it are reviewed together.
Nothing about a stage lives in a console: the load balancer, the cluster, the
Fargate service, the log group, and their scale per stage are all readable in
`lib/service-stack.ts` and `lib/environments.ts`. The definition is evaluated by
a program rather than by a person, which is what makes it reproducible: `npm run
synth` renders all three stages into `cdk.out` from a clean checkout with no AWS
credentials present, because the account and region bind at deploy time instead
of being written into the code. The preview half of this law is what `npm run
diff` is for. It renders the pending change against the deployed stack as a
readable list of resources to add, change, or destroy, with replacements marked,
before anything is applied. The two commands are deliberately separate entry
points: one is a gate that runs on every change, the other is a discipline
performed against a real account with the artifact reference the deploy will
use.

## The check

`npm run synth` (see checks/manifest.yaml) runs `cdk synth` with a placeholder
image tag from the `infra` directory, so it proves the definition still
evaluates and every stage still renders a template; it does not prove a deploy
would succeed, which no synth can. It needs no AWS credentials and reaches no
AWS account, so it runs identically on a contributor's machine and in a
continuous integration job with no cloud role attached. A failure is nearly
always a real error in the definition: an invalid construct property, a Fargate
cpu and memory pair that does not exist, or a stack name CloudFormation would
reject. `npm run diff` is not part of the gate, because a diff needs credentials
and a deployed stack to compare against; it is named in `package.json` so the
preview is a command that already exists rather than one an operator has to
recall under pressure.

## Notes for agents

Run `npm run synth` after every change to `infra/`, the way you would run a test
suite, since it is the fastest signal that a construct is wired correctly. Never
create or modify a resource in the AWS console and then reconcile the code
afterwards: the next deploy applies what the code says and quietly reverts the
console change, usually at the worst moment. Before any deploy, run `npm run
diff -- <stack> --context imageTag=<sha>` with the tag the deploy will use, and
read the output rather than skimming it: lines marked as a replacement destroy
the existing resource, which for anything holding data or a DNS name is the
change worth stopping for. When a value differs between stages, add it to the
`EnvironmentConfig` interface in `lib/environments.ts` and let every stage pass
its own value, rather than branching on a stage name at the point of use or
copying the stack.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
