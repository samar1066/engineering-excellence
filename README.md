# Engineering Excellence Program

[![npm version](https://img.shields.io/npm/v/engineering-excellence)](https://www.npmjs.com/package/engineering-excellence)
[![ci](https://github.com/samar1066/engineering-excellence/actions/workflows/ci.yml/badge.svg)](https://github.com/samar1066/engineering-excellence/actions/workflows/ci.yml)
[![npm provenance](https://img.shields.io/badge/provenance-signed-brightgreen)](https://www.npmjs.com/package/engineering-excellence)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/samar1066/engineering-excellence/badge)](https://securityscorecards.dev/viewer/?uri=github.com/samar1066/engineering-excellence)
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/13939/badge)](https://www.bestpractices.dev/projects/13939)
[![node](https://img.shields.io/node/v/engineering-excellence)](https://www.npmjs.com/package/engineering-excellence)
[![downloads](https://img.shields.io/npm/dm/engineering-excellence)](https://www.npmjs.com/package/engineering-excellence)
[![license](https://img.shields.io/npm/l/engineering-excellence)](LICENSE)

One command turns any repository into a place where AI coding agents build
software the right way. You pick your frameworks; eep installs the doctrine,
generates the agent instructions, and gates every commit with machine checks.
It works on a repository created five minutes ago and one running in production
for a decade, and it works whether your team uses Claude, Copilot, Cursor,
another agent, or none at all.

It also stands up complete cloud applications from one blueprint. A single
command scaffolds a production shaped, Well-Architected AWS full stack
application: a React frontend served through CloudFront, an API with DynamoDB
persistence and Cognito authentication, S3 object storage, and an AWS CDK deploy
pipeline, with every AWS service kept as its own independently validated pack.

```bash
npx engineering-excellence fastapi                     # add the doctrine to any repository
npx engineering-excellence init myapp aws-fullstack    # a whole AWS app, ready to deploy
```

## Contents

1. [Install](#install)
2. [Bring it to an existing repository](#bring-it-to-an-existing-repository)
3. [Start something new](#start-something-new)
4. [Build a complete AWS application](#build-a-complete-aws-application)
5. [Agents and tools it works with](#agents-and-tools-it-works-with)
6. [What we support](#what-we-support)
7. [How the support works](#how-the-support-works)
8. [Why this stays reliable as it grows](#why-this-stays-reliable-as-it-grows)
9. [Command reference](#command-reference)
10. [Contributing](#contributing)
11. [License](#license)

## Install

Install once, and the command is simply `eep` everywhere:

```bash
npm install -g engineering-excellence
```

Prefer no install? Run any command through `npx` and you are always on the
current published version:

```bash
npx engineering-excellence fastapi
```

Both are first class. After a global install you type `eep verify` and
`eep explain EEP-SEC-01`; without it, prefix the same commands with
`npx engineering-excellence`. At the end of a sync the CLI offers the global
install and prints every next step in the form your shell can run. The only
requirement is Node 22 or newer; each framework pack names its own toolchain
(for example uv and Python 3.11 for the FastAPI pack) and tells you when
something is missing.

## Bring it to an existing repository

This is built for repositories that already have a history, a team, and often
their own agent setup. Run the token for your stack from the repository root:

```bash
cd your-service
npx engineering-excellence fastapi
```

eep detects the stack, prints exactly what it will write, and asks before it
touches anything. What it does, and just as importantly what it does not do:

1. **Your agent files are preserved.** If you already have a `CLAUDE.md`,
   `AGENTS.md`, `.github/copilot-instructions.md`, or Cursor rules, eep keeps
   every byte of your content and adds only a clearly fenced managed block. Re
   running only refreshes that block; everything you wrote above and below it
   stays exactly as it was.
2. **Your hooks are preserved.** An existing pre-commit hook is left in place;
   eep installs its gate alongside it with a one line chaining instruction, and
   respects a hook manager such as husky.
3. **Your legacy is not judged.** The default profile is evolving: new and
   changed code must comply, untouched code is baselined, so adopting the
   program never turns your build red on day one.
4. **Nothing conflicts.** Where your own instructions and the doctrine
   disagree, the verify gate is the authority, so nothing you wrote can break
   the system and nothing eep writes erases you.

Then run the gate:

```bash
$ eep verify
PASS EEP-SEC-01 no credential material in 94 scanned files
PASS EEP-TEST-03 ok
SKIP EEP-DOCS-03 Corpus scoped law; consumer repositories are not required to index every directory.
verify: 0 failed, 0 warnings
```

Re run the token command any time with a different list, and eep adds or
removes frameworks to match, updating only what it owns.

## Start something new

A single application, scaffolded complete and already passing:

```bash
npx engineering-excellence init myservice fastapi
```

You get the five layer structure, tests above the coverage gate, structured
logging, tracing, CI, and the generated agent files. Open your agent in the
directory and describe a feature; the instructions carry the rest. We verify
this continuously: an agent given only the generated file ships gate passing
features.

A full enterprise application in one line:

```bash
npx engineering-excellence init shop fastapi react cdk github-actions docker
```

One repository, five packs. What appears in `shop/`:

1. **Three components.** `backend/` is a five layer FastAPI service, `frontend/`
   is a React 18 interface on Vite, and `infra/` is an AWS CDK application that
   deploys the service to AWS Fargate behind a load balancer in three stages:
   dev, uat, and production.
2. **A container layer.** Image definitions under `docker/` with pinned digests,
   and a compose file that starts the components together for local work.
3. **A pipeline.** `.github/workflows/ci.yml` gates every change, and
   `deploy.yml` promotes one built image through the three stages, federating
   with OpenID Connect so no long lived credential is ever stored.
4. **The gates.** `.eep/` holds every law in force with the check that proves
   it, the generated agent files carry the instructions, a pre-commit hook runs
   the gate before a commit exists, and the root `Makefile` fans setup and test
   into the components while `make verify` runs the whole gate at once.

Naming no framework (`npx engineering-excellence init shop`) keeps a single
application at the repository root. Naming one or more composes them into one
repository, each in its own component directory.

## Build a complete AWS application

One command stands up an entire Well-Architected application on AWS, ready to
deploy, with every service kept as its own validated pack:

```bash
npx engineering-excellence init myapp aws-fullstack
```

What lands in `myapp/`:

1. **A React frontend on CloudFront.** The Vite built React app is served from a
   private S3 bucket through a CloudFront distribution over HTTPS, with single
   page app routing.
2. **A DynamoDB backed, Cognito authenticated API.** A five layer FastAPI service
   persists through a DynamoDB table behind its repository interface, and a
   Cognito user pool guards its routes with JSON Web Token validation.
3. **S3 object storage.** An encrypted uploads bucket the service is scoped to
   read and write.
4. **One AWS CDK stack, three stages.** Everything above is provisioned by a
   single AWS CDK application and promoted through dev, uat, and production by an
   OpenID Connect federated GitHub Actions pipeline, so no long lived credential
   is ever stored.
5. **Gates that pass on day one.** Every law is enforced by `eep verify`, a
   pre-commit hook, and CI, and the app passes its own gate the moment it is
   scaffolded. We verify this the hard way: a blind AI agent given only the
   generated instructions adds a persisted, authenticated feature and the gate
   stays green.

The backend is FastAPI by default. Prefer Node.js? Add `--backend node` for a
TypeScript and Node.js backend instead, wired to the same DynamoDB and Cognito
services and held to the same gate:

```bash
npx engineering-excellence init myapp aws-fullstack --backend node
```

An API Gateway serverless compute path and optional capability slices
(asynchronous messaging, search, caching, streaming, and SQL, added with
`--with`) are the next variants on the way, each shipping as its own validated
pack. The laws underneath every pack stay cloud neutral, so an Azure or Google
Cloud blueprint reuses them.

## Agents and tools it works with

The doctrine reaches your agent through the file that agent already reads. eep
asks which tools your team uses and writes only those, so your repository stays
free of files you do not need:

| Tool | File eep maintains |
|---|---|
| Claude and Claude Code | `CLAUDE.md` |
| GitHub Copilot | `.github/copilot-instructions.md` |
| Cursor | `.cursor/rules/eep.mdc` |
| Codex, Gemini CLI, Aider, Zed, and other agents | `AGENTS.md` |

You choose during onboarding (or pass `--tools claude,cursor`), and you can
change the set at any time:

```bash
eep switch-ide cursor copilot
```

That writes the newly chosen files and cleanly removes the ones for tools you
dropped, always preserving any content of your own. Each file is a fenced
managed block (or, for the Cursor rule, a file eep owns by name), so an existing
file of yours is never overwritten. In a composed repository the root file is a
short router and each component directory carries its own golden path, so an
agent loads only what the part it is working in needs.

**Using no AI tool is a first class choice too.** Pick None and eep writes no
agent files at all. The golden path still lives in each pack's `STACK.md`, the
whole system is enforced by `eep verify`, which is just a command a developer or
a CI job can run, and the vendored `.eep/` directory is committed and pinned, so
the rules travel with the repository whether or not eep is ever run again.

## What we support

Two kinds of things. A **blueprint** composes a whole application; **packs** are
the building blocks you compose together or add to an existing repository.

### Blueprints

| Blueprint | What it composes | Token |
|---|---|---|
| **AWS full stack** | A React frontend on CloudFront, a FastAPI or Node backend with DynamoDB and Cognito, S3 object storage, and an AWS CDK deployment | `aws-fullstack` |

Each AWS service the blueprint composes (DynamoDB, Cognito, S3, CloudFront) is
its own validated pack, wired together for you. Pick the backend with
`--backend node`; an API Gateway serverless compute path and capability slices
(async, search, cache, streaming, SQL) are on the way.

### Packs, by layer

| Layer | Available today | On the roadmap |
|---|---|---|
| **Backend** | FastAPI (`fastapi`), Node and TypeScript (`node`) | Go, Java, .NET, C++ |
| **Frontend** | React (`react`) | Angular, React Native |
| **Data and storage** | DynamoDB, Amazon S3 (composed via `aws-fullstack`) | PostgreSQL, Redis |
| **Auth and edge** | Cognito, CloudFront (composed via `aws-fullstack`) | |
| **Infrastructure** | AWS CDK on Fargate (`cdk`), AWS serverless and API Gateway (`aws`), containers and Kubernetes (`docker` or `k8s`) | Terraform, Power Platform |
| **Delivery** | GitHub Actions (`github-actions`) | GitLab CI, Azure DevOps |

The list grows without redesign: every pack is held to one executable contract,
and the CLI discovers packs at runtime, so a new one lights up the moment it
lands. A guided website that emits the finished command is on the roadmap.

## How the support works

1. **Laws.** A small corpus of language agnostic engineering laws (`EEP-XXX-NN`)
   covering architecture, testing, security, observability, delivery,
   documentation, and developer experience. Each law carries a machine check
   contract.
2. **Packs.** Each framework gets a pack that binds those laws to real tools:
   the golden path document your agent follows, the blessed toolchain with its
   configs, a scaffold, and one executable check per law.
3. **Generated agent instructions that respect yours.** eep writes the doctrine
   and your frameworks' golden paths into the file each agent reads (see
   [Agents and tools it works with](#agents-and-tools-it-works-with)), always as
   a preserved managed block, so your own content stays intact.
4. **The gate.** `eep verify` runs every active check and fails with the law,
   file, and line. A pre-commit hook runs it on changed files before a commit
   exists; your CI runs it again. `eep explain EEP-XXX-NN` prints why a rule
   exists and how your stack satisfies it.
5. **Declared deviations.** Exceptions live in `.eep/waivers.yaml` with an
   owner, a justification, and an expiry. Expired waivers fail the build. Some
   laws, like secrets in version control, refuse waivers entirely.

## Why this stays reliable as it grows

1. **One contract, enforced by machines.** A new framework is one directory that
   must pass `pack validate`: schema checked manifest, a binding for every
   applicable law, executable checks, self contained docs. No edits to anything
   existing.
2. **The corpus gates itself.** This repository runs its own validators, its own
   style laws, and its full test suite in CI on every change. If the program
   cannot pass its own gate, it does not ship.
3. **Files first.** Every pack is plain markdown and config, fully usable by
   copying the folder; the CLI is an accelerator, not a dependency. Nothing
   about your repository breaks if you never run eep again.
4. **Open contribution.** Attribution is generated from frontmatter,
   contributions arrive as one pack directory per pull request, and the
   conformance suite reviews format so maintainers review judgment.

## Command reference

| Command | Purpose |
|---|---|
| `npx engineering-excellence [tokens...]` | Sync this repository to exactly those frameworks; bare shows capabilities and what was detected |
| `npx engineering-excellence init <name> [tokens...]` | New compliant project; several tokens compose one repository of components |
| `npx engineering-excellence verify [--changed]` | Run every active law check; exit 1 on blocking failures |
| `npx engineering-excellence explain <LAW-ID>` | Print a law and the active binding for it |
| `npx engineering-excellence switch-ide [tools...]` | Change which AI tools get instruction files; removes the ones you drop |
| `npx engineering-excellence adopt` | Detection based onboarding; the token form above supersedes it for most uses |

After a global install (`npm install -g engineering-excellence`) the command is
simply `eep`.

## Contributing

Clone this repository, read
[packs/stack/python-fastapi/](packs/stack/python-fastapi/) as the reference
pack, and run the contributor gates: `corpus validate` and `pack validate <dir>`
from `tools/eep` (via `npx tsx src/index.ts ...`). A new framework touches no
existing file. Doctrine changes are heavier by design, since every pack inherits
them. See [CONTRIBUTING.md](CONTRIBUTING.md) and [GOVERNANCE.md](GOVERNANCE.md).

## License

Apache-2.0. Authored and maintained by [@samar1066](https://github.com/samar1066).
