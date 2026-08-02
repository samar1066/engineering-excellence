---
title: containers-k8s golden path
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-02
updated: 2026-08-02
---

# containers-k8s golden path

## Purpose

This is the golden path for containerizing a repository composed from the Engineering Excellence packs: read it before editing anything under `docker/`. It is written for the AI coding agent or engineer who has an application that already runs from its component Makefiles and now needs it to run as images, locally and in every deployed environment.

This pack scaffolds no application. It adds one image definition per deployable component, a compose file that starts them together, and one ignore file that governs every build. The components themselves come from the stack packs: python-fastapi at `backend/`, typescript-node at `service/`, react at `frontend/`. A repository with only some of them is normal, and everything here is arranged so the missing ones cost nothing.

What lands in a composed repository:

```
docker/
  backend.Dockerfile     python-fastapi component: uv builder, slim runtime, uvicorn
  service.Dockerfile     typescript-node component: npm builder, slim runtime, node dist/main.js
  frontend.Dockerfile    react component: vite builder, nginx runtime serving the bundle
  nginx.conf             the frontend server: static files plus the /api proxy
docker-compose.dev.yaml  the composed system, one profile per component
.dockerignore            one context filter, shared by all three builds
```

Every build uses the repository root as its context and names its file with `-f`. That is a deliberate choice with three consequences worth knowing: one `.dockerignore` at the root applies to all three builds, `docker/nginx.conf` is reachable from the frontend build without named contexts or a runtime volume mount, and every build command in this document, in CI, and in a release has the identical shape. The cost is that `COPY` sources are written component first, `COPY backend/app ./app` rather than `COPY app ./app`.

## The three definitions

Each file carries a header comment naming the pack whose component it serves, so a reader never has to guess which source tree a definition belongs to. Each is two stages: a builder that resolves dependencies and produces an artifact, and a runtime that receives only that artifact.

| Definition | Component | Builder base | Runtime base | User | Port | Entry |
|------------|-----------|--------------|--------------|------|------|-------|
| docker/backend.Dockerfile | backend, python-fastapi | python:3.11-slim-bookworm | python:3.11-slim-bookworm | uid 10001 | 8000 | uvicorn app.main:app |
| docker/service.Dockerfile | service, typescript-node | node:22-bookworm-slim | node:22-bookworm-slim | node | 3000 | node dist/main.js |
| docker/frontend.Dockerfile | frontend, react | node:22-bookworm-slim | nginx:1.27-alpine | nginx | 8080 | nginx daemon off |

`docker/backend.Dockerfile` serves the python-fastapi component. The builder starts from `python:3.11-slim-bookworm`, installs a pinned uv through the `UV_VERSION` build argument, copies `backend/pyproject.toml` and `backend/uv.lock`, and runs `uv sync --frozen --no-dev --no-install-project` into `/opt/venv`. `--frozen` is the point: uv refuses to re-resolve, so the image either matches the committed lockfile or fails. Manifests are copied before source, so an application edit reuses the cached dependency layer. The runtime starts from the same base, adds curl for the healthcheck and nothing else, creates a system user at uid 10001, copies `/opt/venv` and the application across, drops to that user, exposes 8000, and runs `uvicorn app.main:app`. Its healthcheck calls `GET /health`, which `backend/app/api/routes/health.py` serves.

`docker/service.Dockerfile` serves the typescript-node component. The builder starts from `node:22-bookworm-slim`, copies `service/package.json` and `service/package-lock.json`, runs `npm ci`, copies the two tsconfig files and `service/src`, runs `npm run build` (which is `tsc -p tsconfig.build.json`, emitting `src` into `dist`), then runs `npm prune --omit=dev` so the compiler and the test runner never reach the runtime. The runtime copies `node_modules`, `dist`, and `package.json`, uses the image's own `node` user, exposes 3000, and runs `node dist/main.js`. Its healthcheck probes `GET /health` with the global fetch built into Node 22, so no client is installed to support it.

`docker/frontend.Dockerfile` serves the react component. The builder starts from `node:22-bookworm-slim`, runs `npm ci` from the lockfile, copies the component, and runs `npm run build` (which is `tsc --noEmit && vite build`, writing `dist`). `VITE_API_URL` is a build argument because Vite inlines it into the bundle at build time; it is not runtime environment and setting it as such changes nothing. The runtime starts from `nginx:1.27-alpine`, copies `docker/nginx.conf` over `/etc/nginx/nginx.conf`, substitutes the `BACKEND_UPSTREAM` build argument into the upstream block, removes the image's own default site, copies the bundle into `/usr/share/nginx/html`, drops to the `nginx` user, and listens on 8080. It clears the inherited entrypoint, whose template and ipv6 scripts expect to run as root.

`docker/nginx.conf` is a complete configuration rather than a `conf.d` fragment, because an unprivileged server has to move its pid file and every temporary path under `/tmp`, and only the top level file can do that. It serves the bundle, falls back to `index.html` so client routes resolve, caches hashed assets hard and `index.html` never, and proxies `/api/` to the upstream with a trailing slash on `proxy_pass`, which strips the prefix exactly the way `frontend/vite.config.ts` strips it in development.

Three properties hold in every file and are worth defending in review: base images are named by a fixed tag and never `latest`, every runtime stage drops to a non root user before its `CMD`, and no stage carries a secret. Configuration arrives as environment at run time, which is why the compose file holds the environment blocks and the definitions hold none. A build argument is visible in image history, so it suits `VITE_API_URL` and the nginx upstream and never a credential.

## What the definitions assume

Each image depends on a small, stable contract with the component it builds. Break one of these in a component and the build, not the deployment, is where you find out.

| Component | The definition expects |
|-----------|------------------------|
| backend | `pyproject.toml` plus a committed `uv.lock`, an importable `app` package with `app.main:app`, and `GET /health` |
| service | `package.json` plus `package-lock.json`, a `build` script emitting `src` into `dist` with `main.js` as the entry, and `GET /health` |
| frontend | `package.json` plus `package-lock.json`, a `build` script writing `dist`, and an API client that reads `VITE_API_URL` and defaults to a same origin `/api` |

## Adding a component

A fourth deployable component is a new file, never a branch inside an existing one. Two components sharing one definition is how a build starts depending on which target somebody remembered to pass.

1. Write `docker/<component>.Dockerfile` with a header comment naming the pack it serves and the build command for it, copying the pattern of the closest existing file.
2. Keep the two stage split, pin the base tag, install from the component's lockfile, and drop to a non root user before `CMD`.
3. Add a service to `docker-compose.dev.yaml` with profiles `["all", "<component>"]`, a root context, and its port mapping.
4. Run `docker build --check -f docker/<component>.Dockerfile .` and then `docker compose -f docker-compose.dev.yaml --profile <component> build`.
5. Add the component's build job to the delivery workflow, tagging with the same commit sha the other components use.

## The local loop

The composed root Makefile fans `setup`, `test`, and `verify` into the components. Containers are deliberately not wired into it: an image build is slower than a test run and does not belong in the loop an engineer repeats every minute. These are the commands, run from the repository root.

1. `docker compose -f docker-compose.dev.yaml --profile all up --build` starts every component, building first.
2. `docker compose -f docker-compose.dev.yaml --profile backend up --build` starts one component. Swap `backend` for `service` or `frontend`.
3. `docker compose -f docker-compose.dev.yaml --profile all build` builds every image without starting anything, which is the fastest way to prove a change to a definition really builds.
4. `docker compose -f docker-compose.dev.yaml --profile all logs -f frontend` follows one service's output.
5. `docker compose -f docker-compose.dev.yaml --profile all down` stops everything and removes the network.

Every service sits behind a profile, so nothing starts without one being named and a repository missing a component still parses and still runs what it has. The frontend depends on the backend being healthy, declared with `required: false`, so the frontend profile runs alone in a repository that has no backend at all.

Ports: the backend answers on `http://localhost:8000`, the service on `http://localhost:3000`, and the frontend on `http://localhost:5173`, which is the port the Vite dev server uses so the bookmark does not change between the two ways of running the interface. Inside the network, services reach each other by service name, which is why the nginx upstream defaults to `backend:8000`.

Two things to know before the first build. The backend build needs `backend/uv.lock`, which `make setup` writes and which belongs in version control; a repository that has never run setup has no lockfile yet, and the build says so. And compose here runs the system the way it will ship, from production shaped images, so a source edit needs a rebuild. Hot reload stays where it already is: `make run` inside a component.

## Tagging

An image is identified by the commit it was built from. Nothing else is a durable identity.

1. The immutable tag is the full git sha: `docker build -f docker/backend.Dockerfile -t <registry>/<repo>/backend:$(git rev-parse HEAD) .` from the repository root. It is written once and never moved.
2. `latest` is never deployed. Publish it if a human convenience tag helps, but no environment, no compose file, and no infrastructure definition may reference it, because a tag that moves makes two deployments of the same reference produce different software.
3. Environment names are not tags. A rebuild for each environment produces a different image from the one that passed verification, which gives up the entire reason to build an image. Environments differ by configuration, not by artifact.
4. The compose file tags its images `:dev` because they are rebuilt from the working tree on every `up --build` and are never pushed anywhere.

## The deep check

The gate check for EEP-IAC-02 is `file-contains-any docker FROM`, a builtin that needs no daemon and no network. It proves the definitions exist in version control and stops there, deliberately, because parsing an instruction set correctly requires the builder that will execute it.

The deep check is BuildKit's own, run once per definition from the repository root:

```
docker build --check -f docker/backend.Dockerfile .
docker build --check -f docker/service.Dockerfile .
docker build --check -f docker/frontend.Dockerfile .
```

`--check` runs the real frontend over the file, reports malformed instructions, unknown flags, stage mistakes, and lint warnings such as an unpinned base or a shadowed stage name, then stops before executing a single step. It costs about a second, needs no registry, and is the command to run locally before pushing any change under `docker/`. It parses instructions rather than executing them, so it will not tell you that a `COPY` source is missing or that a build argument is wrong; `docker compose --profile all build` answers those. On a machine with no daemon, neither is available, and the file existence check is the only proof the gate can offer.

## How delivery consumes these images

The delivery pack builds once and promotes the tag. The shape of that pipeline, which this pack is designed to feed:

1. Continuous integration runs every component's own gate through `eep verify`, which includes the EEP-IAC-02 file check.
2. One build job per component builds from these definitions with the repository root as context and tags the result with the commit sha, then pushes to the registry.
3. The non production deployment resolves that exact tag. No rebuild happens.
4. Promotion to production redeploys the same reference. The only thing that moves between environments is the environment's own configuration, injected as environment variables and secrets by the infrastructure pack.

Two rules keep that promise intact. Never rebuild during promotion, because the artifact that reaches users must be the artifact that passed verification. And never reference a tag that can move, in a workflow, a task definition, or a compose file.

## When you deviate

The golden path is the default, not a cage. When a rule genuinely does not fit, declare a waiver in `.eep/waivers.yaml` naming the law ID, an owner, and an expiry date of at most 90 days, with a sentence on why. EEP-IAC-02 is waivable on those terms.

Two deviations come up often and neither needs a waiver, because neither breaks the law. A component that is not deployed as a service, a library or a shared schema package, has nothing to containerize: it simply gets no file under `docker/`. And a component whose runtime genuinely cannot use the bases here, a job that needs a GPU image for instance, gets its own definition next to its siblings with a header comment explaining the base, which is still one definition per component in version control.

What does need a waiver is deleting a deployable component's definition, running a runtime stage as root, or pointing an environment at a floating tag. Never suppress the situation instead of declaring it: a definition quietly excluded from the build is exactly the unexercised file this law exists to catch.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
