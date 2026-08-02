---
title: EEP-IAC-02 binding
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-02
updated: 2026-08-02
---

## How this pack satisfies it

Every deployable component in a composed repository gets exactly one image
definition, and all of them live together in `docker/` at the repository root:
`backend.Dockerfile` for the python-fastapi component, `service.Dockerfile` for
the typescript-node component, and `frontend.Dockerfile` for the react
component. Each file names in its header comment the pack whose component it
serves, so a reader can tell in one line which source tree a definition
belongs to, and a component added later is a new file next to its siblings
rather than an edit to a shared one.

The definitions install from the same pinned manifests a contributor installs
from. The backend builder copies `pyproject.toml` and `uv.lock` and runs
`uv sync --frozen`, which refuses to proceed if the lockfile disagrees with the
project file; the node builders copy `package.json` and `package-lock.json` and
run `npm ci`, which fails the same way. An image therefore resolves the exact
dependency graph the component's own EEP-DLV-02 check already holds its
contributors to, instead of a fresh resolution that happens to work today.

Every base image is referenced by a fixed tag, never `latest`: the interpreter,
the runtime, and the operating system all move only when someone edits the
line that names them. Every runtime stage drops to an unprivileged user before
its `CMD`, and the nginx runtime listens on 8080 so it never needs the
privileged port range. The multi stage split keeps build tooling, compilers,
and development dependencies in a stage that is discarded, so what ships is the
runtime plus the built artifact and nothing else.

`docker-compose.dev.yaml` at the repository root builds those same definitions
for the local loop, so the images an engineer runs on a laptop come from the
files a release builds from, and a broken instruction surfaces during the
change that introduced it rather than during a deployment.

## The check

`file-contains-any docker FROM` (see checks/manifest.yaml) is a builtin check
that scans every file under `docker/` for a `FROM` instruction and passes on
the first one it finds. It proves the cheap half of the contract everywhere,
with no daemon and no network: a repository composed from this pack carries
container definitions in version control, and deleting them or emptying them
fails the gate. It deliberately does not prove that each definition is
well formed, because parsing an instruction set correctly requires the builder
that will execute it.

The deep half is `docker build --check -f docker/<name>.Dockerfile .` run from
the repository root, once per definition. It runs the real BuildKit frontend
over the file, reports malformed instructions, unknown flags, and stage
mistakes, and stops before executing a single step, so it costs a second and
needs no registry push. STACK.md documents it as the command to run locally
before pushing a change to any definition, and the delivery pack's build job
exercises the same files for real by building them.

## Notes for agents

Add a component, add its definition. A new deployable component means a new
`docker/<component>.Dockerfile` with a header comment naming the pack it
serves, and a new service in `docker-compose.dev.yaml` behind its own profile.
Never containerize a component by extending another component's file with a
conditional stage: two components sharing one definition is how a build starts
depending on which target someone remembered to pass.

When you change a definition, run `docker build --check` on it before you push,
and run `docker compose -f docker-compose.dev.yaml --profile all build` when
the change touches a build argument or a copied path, because `--check` parses
instructions and does not verify that a `COPY` source exists.

Keep the base image tag fixed and bump it deliberately. Replacing
`python:3.11-slim-bookworm` with `python:latest` makes two builds of the same
commit produce different images, which is the failure this law exists to
prevent, and the difference will surface in the environment least able to
absorb it. The same applies to the `UV_VERSION` build argument: it is pinned so
that the builder itself is part of the reviewed change.

Never bake a secret into an image. Configuration arrives as environment at run
time, which is why the compose file carries the environment blocks and the
definitions carry none. A build argument is visible in image history, so it is
appropriate for `VITE_API_URL` and the nginx upstream and never for a
credential.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
