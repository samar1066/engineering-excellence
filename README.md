# Engineering Excellence Program

One command turns any repository into a place where AI coding agents build
software the right way. You pick your frameworks; eep installs the doctrine,
generates the agent instructions, and gates every commit with machine checks.

```bash
npx engineering-excellence fastapi
```

## Install

1. **Zero install.** Run everything through `npx engineering-excellence ...`
   and you are always on the current published version.
2. **One global install.** `npm install -g engineering-excellence` once, and
   the command is simply `eep`: `eep verify`, `eep explain EEP-SEC-01`.

At the end of a sync the CLI offers that global install, and prints every next
step in the form your shell can actually run.

Pick several at once, space separated, and re run the command any time with a
different list to add or remove frameworks:

```bash
npx engineering-excellence fastapi node angular
```

Run it bare to see what is supported and what was detected in your project:

```bash
npx engineering-excellence
```

## Enterprise app in one command

```bash
npx engineering-excellence init shop fastapi react cdk github-actions docker
```

One line, one repository, five packs. What appears in `shop/`:

1. **Three components.** `backend/` is a five layer FastAPI service, `frontend/` is a React 18 interface on Vite, and `infra/` is an AWS CDK application that deploys the service to AWS Fargate behind a load balancer, in three stages: dev, uat, and production.
2. **A container layer.** Image definitions under `docker/` and a compose file at the root that starts the components together for local work.
3. **A pipeline.** `.github/workflows/ci.yml` gates every change, and `deploy.yml` promotes one built image through the three stages, federating with OpenID Connect so no long lived credential is ever stored.
4. **The gates.** `.eep/` holds every law in force with the check that proves it, `CLAUDE.md` and `AGENTS.md` carry the instructions your agent reads, a pre-commit hook runs the gate before a commit exists, and the root `Makefile` fans `make setup` and `make test` into the components while `make verify` runs the whole gate at once.

Re run the token command inside the project at any time with a different list, and eep adds or removes frameworks to match.

Naming no framework (`npx engineering-excellence init shop`) keeps that single application at the repository root. Naming one or more, as above, composes them into one repository, each in its own component directory.

## What we support

**Backend**

| Framework | Token | Status |
|---|---|---|
| C++ | `cpp` | In development |
| FastAPI (Python) | `fastapi` | Available |
| Go | `go` | In development |
| Java Spring | `java` | In development |
| .NET ASP.NET | `dotnet` | In development |
| Node and TypeScript services | `node` | Available |
| SQL and Postgres | `sql` | In development |

**Frontend**

| Framework | Token | Status |
|---|---|---|
| Angular | `angular` | In development |
| React | `react` | Available |
| React Native | `react-native` | In development |

**Infrastructure and containers**

| Platform | Token | Status |
|---|---|---|
| AWS CDK Fargate | `cdk` | Available |
| AWS serverless | `aws` | Available |
| Containers and Kubernetes | `docker` or `k8s` | Available |
| Power Platform | `power-platform` | In development |
| Terraform | `terraform` | In development |

**Delivery and CI**

| Platform | Token | Status |
|---|---|---|
| Azure DevOps | `azure-devops` | In development |
| GitHub Actions | `github-actions` | Available |
| GitLab CI | `gitlab` | In development |

The list grows without redesign: every framework is a pack held to one
executable contract, and the CLI discovers packs at runtime, so a new
framework lights up the moment its pack lands. A guided website that walks you
through the selection and hands you the finished command is on the roadmap.

## How the support works

1. **Laws.** A small corpus of language agnostic engineering laws (`EEP-XXX-NN`) covering architecture, testing, security, observability, delivery, documentation, and developer experience. Each law carries a machine check contract.
2. **Packs.** Each framework gets a pack that binds those laws to real tools: the golden path document your agent follows, the blessed toolchain with its configs, a scaffold, and one executable check per law.
3. **Generated agent instructions that respect yours.** eep maintains a clearly fenced managed block inside `CLAUDE.md` and `AGENTS.md`; if those files already exist in your repository, every byte of your own content is preserved and only the block is added or refreshed. Every mainstream agent reads these files automatically; the block carries the tenets, your frameworks' golden paths, and the table of laws in force. Where your instructions and the doctrine disagree, the verify gate is the authority, so nothing you wrote can break the system and nothing eep writes erases you.
4. **The gate.** `eep verify` runs every active check and fails with the law, file, and line. A pre-commit hook runs it on changed files before a commit exists (an existing hook of yours is preserved; eep installs alongside it with a one line chaining instruction); your CI runs it again. `eep explain EEP-XXX-NN` prints why a rule exists and how your stack satisfies it.
5. **Declared deviations.** Exceptions live in `.eep/waivers.yaml` with an owner, a justification, and an expiry. Expired waivers fail the build. Some laws, like secrets in version control, refuse waivers entirely.

## Why this stays reliable as it grows

1. **One contract, enforced by machines.** A new framework is one directory that must pass `pack validate`: schema checked manifest, a binding for every applicable law, executable checks, self contained docs. No edits to anything existing.
2. **The corpus gates itself.** This repository runs its own validators, its own style laws, and its full test suite in CI on every change. If the program cannot pass its own gate, it does not ship.
3. **Files first.** Every pack is plain markdown and config, fully usable by copying the folder; the CLI is an accelerator, not a dependency. Nothing about your repo breaks if you never run eep again: the vendored `.eep/` is pinned, committed, and readable by any agent.
4. **Open contribution.** Attribution is generated from frontmatter, contributions arrive as one pack directory per pull request, and the conformance suite reviews format so maintainers review judgment.

## Example: an existing FastAPI project

```bash
cd your-service
npx engineering-excellence fastapi
```

eep detects the stack, shows you exactly what it will write, and asks first.
You get `.eep/` (the pinned laws and pack), the generated agent files, and the
hook. The default profile is evolving: new and changed code must comply,
untouched legacy is not judged. Then:

```bash
$ eep verify
PASS EEP-SEC-01 no credential material in 94 scanned files
PASS EEP-TEST-03 ok
SKIP EEP-DOCS-03 Corpus scoped law; consumer repositories are not required to index every directory.
verify: 0 failed, 0 warnings
```

Starting from nothing instead? `npx engineering-excellence init myservice` scaffolds a
complete, already passing service (five layer structure, tests above the
coverage gate, logging, tracing, CI) and adopts it in one step. Open your
agent in the directory and type a feature request; the generated instructions
carry everything else. We verify this journey continuously: a blind agent
given only the generated file ships gate passing features.

## Command reference

| Command | Purpose |
|---|---|
| `npx engineering-excellence [tokens...]` | Sync this repo to exactly those frameworks; bare shows capabilities |
| `npx engineering-excellence init <name> [tokens...]` | New compliant project in one command; several tokens compose one repository of components |
| `npx engineering-excellence verify [--changed]` | Run every active law check; exit 1 on blocking failures |
| `npx engineering-excellence explain <LAW-ID>` | Print a law and the active binding for it |
| `npx engineering-excellence adopt` | Detection based onboarding (the token form supersedes it for most uses) |

After a global install (`npm install -g engineering-excellence`) the command is simply `eep`.

## Contributing

Clone this repository, read
[packs/stack/python-fastapi/](packs/stack/python-fastapi/) as the reference
pack, and run the contributor gates: `corpus validate` and
`pack validate <dir>` from `tools/eep` (via `npx tsx src/index.ts ...`).
A new framework touches no existing file. Doctrine changes are heavier by
design, since every pack inherits them.

## License

Apache-2.0. Authored and maintained by [@samar1066](https://github.com/samar1066).
