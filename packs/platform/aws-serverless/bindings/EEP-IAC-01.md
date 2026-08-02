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

## How this platform satisfies it

The whole serverless environment, the HTTP API, the function, its log group, its
retention, and its memory, is a CDK v2 TypeScript application committed in
`infra-serverless/` beside the service it fronts, so an environment change
arrives as a reviewable diff with an author and a reason instead of as a click
in a console. Nothing about a stage lives outside the definition: what differs
between dev, uat, and prod is data in `lib/environments.ts`, and `bin/app.ts`
instantiates the one `ApiStack` template once per entry, so a single reviewed
change describes every environment it targets. Account and region are the only
values the definition refuses to hold: `bin/app.ts` reads whatever the CDK CLI
resolved into `CDK_DEFAULT_ACCOUNT` and `CDK_DEFAULT_REGION` from the
credentials the command runs under, which keeps account ids out of version
control and makes synthesis work on a machine with no credentials at all. The
scaffold's handler is inline for the same reason: with no bundler, no Docker
daemon, and no network in the path, evaluating the definition produces the same
templates from a clean checkout on any machine.

## The check

`npm run synth` (see checks/manifest.yaml) runs `cdk synth`, which evaluates the
app and writes one CloudFormation template per stage into `cdk.out/`. It fails
on a construct that cannot be built, a property that does not typecheck at
synthesis, or a validation error inside aws-cdk-lib, which is the whole class of
mistakes that would otherwise be discovered by a deployment. The preview half of
the law is the second entry point the same package.json declares: `npm run diff`
runs `cdk diff`, which compares this checkout against what is actually deployed
and prints every resource that would be created, replaced, or destroyed. Synth
is the gate because it needs no credentials and is therefore honest in
continuous integration; diff is the preview because it reads deployed state, and
its output belongs in the change under review before anyone approves a deploy.

## Notes for agents

When synth fails, read the construct path in the error before touching anything:
it names the stack, then the construct id, then the property, and the fix is
nearly always in `lib/api-stack.ts` rather than in the environment list. Never
pin an account id or a region literal into `lib/environments.ts` to make a
synthesis error go away; that trades a broken check for a definition nobody
outside one account can evaluate. Adding a stage means one entry in
`environments`, never a copied stack file. Before proposing an infrastructure
change for review, run `npm run diff` against the target stage and attach the
output, and treat any line reporting a replacement of a stateful resource as a
change that needs a plan rather than an approval.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
