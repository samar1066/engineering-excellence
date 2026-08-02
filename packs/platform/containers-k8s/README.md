---
title: containers-k8s
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-02
updated: 2026-08-02
---

# containers-k8s

A Tier 1 platform pack that binds the Engineering Excellence Program, program version 0.2.0, to container definitions for a composed repository. A repository matches this pack when it carries a `docker-compose.dev.yaml` at its root. Unlike a stack pack, it scaffolds no application and claims no component directory: it augments whatever components the stack packs put in place with one image definition each, a compose file that starts them together, and a single ignore file governing every build. It implements exactly one law and is honest about the rest.

## What this pack gives you

- `STACK.md`: the golden path an AI coding agent reads before touching anything under `docker/`, covering the definitions, the local loop, tagging, and the deep check.
- Three multi stage image definitions in `scaffold/docker/`, one per stack pack component: `backend.Dockerfile` for python-fastapi, `service.Dockerfile` for typescript-node, `frontend.Dockerfile` for react, plus the `nginx.conf` the frontend image serves from.
- `scaffold/docker-compose.dev.yaml`: the composed system behind one profile per component, so a repository with only some components still parses and still runs what it has.
- `scaffold/.dockerignore`: one context filter shared by all three builds, which is possible because every build uses the repository root as its context.
- An executable check in `checks/manifest.yaml` mapping EEP-IAC-02 to the command proving it, with the deeper `docker build --check` documented in `STACK.md`.

## Laws implemented

This pack implements one law:

- EEP-IAC-02

The how and the why live in `bindings/EEP-IAC-02.md`.

It declines thirteen laws. Every one of them is real work that a composed repository still has to do; it is simply owned by a pack that scaffolds the code the law governs, and gated there.

| Law | Reason |
|-----|--------|
| EEP-ARCH-01 | Stack scoped law, gated by the stack packs present. This pack adds no application code and owns no import graph. |
| EEP-TEST-01 | Stack scoped law, gated by the stack packs present. A container definition carries no unit under test. |
| EEP-TEST-03 | Stack scoped law, gated by the stack packs present. Coverage is measured over application source, which this pack does not author. |
| EEP-SEC-01 | Stack scoped law, gated by the stack packs present. This pack bakes no credential into an image and adds no scanner of its own. |
| EEP-SEC-02 | Stack scoped law, gated by the stack packs present. No query is constructed anywhere here. |
| EEP-OBS-01 | Stack scoped law, gated by the stack packs present. Logging is configured inside each service process; an image only forwards the stream. |
| EEP-OBS-02 | Stack scoped law, gated by the stack packs present. Trace initialization happens in service startup code. |
| EEP-DLV-01 | Delivery scoped law, gated by the delivery pack present, which owns `.github`. This pack deliberately never writes there. |
| EEP-DLV-02 | Stack scoped law, gated by the stack packs present. These images consume component lockfiles rather than producing one. |
| EEP-DOCS-01 | Stack scoped law, gated by the stack packs present, which own the docs directory. |
| EEP-DOCS-02 | Stack scoped law, gated by the stack packs present. This pack places no markdown into a composed repository. |
| EEP-DEVX-01 | Stack scoped law, gated by the stack packs present. The entry points are the composed root Makefile and each component Makefile. |
| EEP-DOCS-03 | Corpus scoped law; consumer repositories are not required to index every directory. |

## Blessed toolchain

| Tool | Config | Rationale |
|------|--------|-----------|
| docker with BuildKit | | BuildKit is the default builder from Docker 23 and the reason a multi stage file is cheap: unused stages are skipped, independent stages run in parallel, and the content addressed cache keeps a dependency layer alive across an application change. It also carries `docker build --check`. |
| docker compose | `scaffold/docker-compose.dev.yaml` | One file starts the composed system from the same definitions a release builds from, so a local run and a deployed run differ in configuration only. |

Both rows are declared in `pack.yaml` as first class toolchain entries, and repeated here and in `STACK.md` for a reader who never opens the manifest. Every other category the schema defines is declined in `pack.yaml` with a reason, since this pack authors no application source for one to act on.

## Standalone use

Copy this folder plus CONSTITUTION.md into any repository, copy `scaffold/docker/`, `scaffold/docker-compose.dev.yaml`, and `scaffold/.dockerignore` to the repository root, and point your agent at `STACK.md`; the eep CLI is an accelerator, not a requirement. The definitions expect components at `backend/`, `service/`, and `frontend/`, and a repository with a different layout adjusts the `COPY` prefixes and the compose services and keeps everything else. Docker 23 or later is the only prerequisite for the build and compose commands, and `docker build --check` needs the same daemon those commands already need. Without Docker at all, the law's gate check still runs, because `file-contains-any docker FROM` is implemented inside the CLI and reads files rather than building anything.

## Related

- Law IDs: EEP-IAC-02; declined: EEP-ARCH-01, EEP-TEST-01, EEP-TEST-03, EEP-SEC-01, EEP-SEC-02, EEP-OBS-01, EEP-OBS-02, EEP-DLV-01, EEP-DLV-02, EEP-DOCS-01, EEP-DOCS-02, EEP-DEVX-01, EEP-DOCS-03.
- Packs: this pack requires no other packs. Its definitions build the components scaffolded by python-fastapi, typescript-node, and react, and the images it defines are consumed by the delivery pack that owns the deployment workflows.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
