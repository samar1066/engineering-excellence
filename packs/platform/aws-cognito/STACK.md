---
title: aws-cognito golden path
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-03
updated: 2026-08-03
---

# aws-cognito golden path

## Purpose

This is the golden path for authenticating a route with Amazon Cognito in a project built from the aws-cognito pack: read it before you protect an endpoint. It is written for the AI coding agent or engineer who has a backend with public routes and now needs some of them to run only for a signed-in caller. Every path and command below exists in this pack's scaffold, so copy working patterns from it instead of inventing new ones. The pack supplies authentication for a backend it sits beside; it does not scaffold the application, and the routes it guards are the backend pack's, not its own.

## Project shape

The auth component is one small polyglot project. One line per directory, one responsibility each:

```
auth/
  cognito.json         the detect marker and the shared names: the pool id, client id, and region env vars
  construct/
    user-pool.ts       the user pool and app client: password policy, advanced security, email sign-in, least privilege client, tags
    user-pool.test.ts  vitest assertions over the rendered template: password policy, the client, the tags
  wiring/
    python/
      app/api/auth.py            require_user, a FastAPI dependency that validates a Cognito access token
      app/core/config.py         the reference config the guard reads region, pool id, and client id from
      tests/                     the guard's unit test, run against a mocked JWKS and locally minted tokens
      pyproject.toml             the Python project for the guard and its test
    typescript/
      src/auth.ts                requireUser, the Fastify preHandler equivalent over aws-jwt-verify
      src/core/config.ts         the reference config the guard reads its Cognito coordinates from
      test/auth.test.ts          the guard's reject-path test, which needs no Cognito
  package.json           the Node project for the construct and the TypeScript guard
  tsconfig.json
  biome.json
  vitest.config.ts
```

The guard is the only code that knows Cognito is behind the bearer token. Everything above it, the routes and the workflows in the backend, keeps speaking the domain and reads the caller off the request when it needs one.

## The rules of the shape

Three rules keep the seam honest.

Validate the access token, not the id token. The guard verifies a Cognito ACCESS token: it checks the RS256 signature against the pool's published JWKS, the issuer, the expiry, that `token_use` is `access`, and that `client_id` matches the configured client, and only then trusts a claim. An id token describes who signed in for a UI to render; an access token authorizes an API call, and the API is what this backend is.

Gate at the router, read at the route. The guard is applied once as a router-level dependency, so every route it guards runs only for an authenticated caller and the health route stays public. A route that needs the caller's identity re-declares the guard in its own signature and receives the same verified user; a route that only needs the gate declares nothing.

Keep the API tests honest without a real pool. The API test suite overrides the guard with a fake authenticated user, exactly as it already overrides the workflow with an in-memory repository. The swap keeps the guarded routes green with no Cognito in the loop, because the token validation itself is proven by the guard's own unit test, not by driving a real pool through the HTTP layer.

## Adding an authenticated route

Work from the guard outward. This is the exact order, using the notes routes as the worked example:

1. Provision the pool. Copy `construct/user-pool.ts`: a user pool with email sign-in, a strong password policy, advanced security enforced, account recovery by email, and an app client scoped to the SRP and refresh flows with no secret. Compose it into the aws-cdk service stack so it deploys beside the service, and keep its assertions in `user-pool.test.ts`.
2. Pass the pool's coordinates to the service. The stack hands the container `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, and `AWS_REGION`, and `app/core/config.py` (or `src/core/config.ts`) reads them from the environment. The guard trusts the same pool the stack provisions because it reads the same three values.
3. Drop in the guard. Copy `wiring/python/app/api/auth.py` to `app/api/auth.py` (or `wiring/typescript/src/auth.ts` to `src/auth.ts`). It fetches the pool JWKS once and caches it, verifies the access token, and yields a small typed user on success or raises a 401.
4. Protect the router. In the python-fastapi backend, add the guard as a router-level dependency on the notes router: `APIRouter(prefix="/notes", tags=["notes"], dependencies=[Depends(require_user)])`. In the typescript-node backend, register the notes routes inside a scope that adds the guard as a `preHandler`. The health router is a separate registration and stays public.
5. Read the caller where a route needs one. A route that acts on the signed-in user declares the guard in its own signature and reads the identity from it: `async def create_note(..., user: AuthenticatedUser = Depends(require_user))` in Python, or `request.user` after the preHandler in TypeScript. The `sub` claim is the stable caller id.
6. Keep the API tests green. In `tests/conftest.py`, override the guard alongside the workflow so the API-test app runs with a fake authenticated user:

   ```python
   application.dependency_overrides[get_notes_workflow] = lambda: workflow
   application.dependency_overrides[require_user] = lambda: AuthenticatedUser(sub="test-user")
   ```

   In the typescript-node backend, pass a fake guard into `createApp` in `test/helpers/app.ts` that sets `request.user`. This override is part of the recipe, not an afterthought: without it the guarded routes would demand a real token and the suite would redden.
7. Prove both halves. Run `npm run test:construct` to prove the pool still declares its password policy, its least privilege client, and its tags, and run the guard's unit test (`pytest` in `wiring/python`, or `npm run test:guard`) to prove the token validation accepts a well formed access token and rejects every way one can be wrong.

The smallest complete example of this loop is the notes routes themselves: the construct assertions cover the pool, and the guard's unit test covers the validation, against a mocked JWKS so the proof needs no AWS account.

## Toolchain

The blessed tools. Do not substitute alternatives without a waiver.

| Category | Tool | Command |
|----------|------|---------|
| Language | TypeScript strict | `npm run build` |
| Runtime | python 3.11 | declared as `requires-python` in `wiring/python/pyproject.toml` |
| Infrastructure library | aws-cdk-lib v2 | `npm run test:construct` |
| Package manager | npm | `npm ci` |
| Formatter | biome format | `npx biome format --write .` |
| Linter | biome | `npm run lint` |
| Type checker | tsc --noEmit | `npm run build` |
| Unit tests | vitest with aws-cdk-lib assertions | `npm run test:construct` |

Daily work drives through a few commands:

1. `npm ci` and `pip install -e wiring/python`: install the Node and Python projects.
2. `npm run test:construct`: assert on the rendered pool template, credential free.
3. `python -m pytest` in `wiring/python`: run the guard's token-validation test against a mocked JWKS.
4. `npm run build`: typecheck the construct and the TypeScript guard.

None of these needs Docker or an AWS account: the construct assertions synthesize the template in process, and the guard test mints and verifies its own tokens against a local key.

## What verify checks here

`make verify` runs every check in `checks/manifest.yaml`, from the `auth` directory. All three are shell checks you can run by hand while iterating:

| Law | Kind | Command |
|-----|------|---------|
| EEP-SEC-04 | shell | `npm run test:construct -- -t "advanced security and a strong password policy"` |
| EEP-SEC-03 | shell | `npm run test:construct -- -t "minimal auth flows"` |
| EEP-COST-01 | shell | `npm run test:construct -- -t "tags the user pool"` |

Each synthesizes the pool in process and reads the rendered template, so none needs an AWS account. They prove the credential protection the pool enforces, the least privilege of its app client, and the attribution tags it carries.

Thirteen laws are declined by this pack rather than implemented, because they are scoped to the application the backend pack owns or to the pipeline the delivery pack owns. The reasons are recorded one by one in `pack.yaml` and summarized in the pack README.

## When you deviate

The golden path is the default, not a cage. When a rule genuinely does not fit, declare a waiver in `.eep/waivers.yaml` naming the law ID, an owner, and an expiry date, with a sentence on why. Never suppress a check inline without a matching waiver: inline suppressions hide deviations, while waivers keep them visible, owned, and temporary.

One deviation is worth naming in advance. Validating the id token instead of the access token is the common mistake, and it fits a UI reading a profile, not an API authorizing a call. If a route genuinely needs an identity attribute the access token does not carry, read it from a verified claim the access token does carry, or fetch it once from the user info endpoint, rather than trusting an id token as an API credential.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-03*
