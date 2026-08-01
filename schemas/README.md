---
title: Schemas
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-01
updated: 2026-08-01
---

# Schemas

This folder holds the JSON Schema documents that define the machine contract for every structured file in the corpus, loaded by the eep CLI at validation time and by corpus CI on every pull request.

## Overview

These schemas are the machine contract for laws, packs, toolchains, consumer config, and waivers, loaded by the CLI and by corpus CI. Each schema pins its shape with the JSON Schema 2020-12 dialect and rejects unknown properties, so a malformed law, pack, or waiver fails fast with a specific field level error instead of surfacing as a confusing downstream failure. The pack schema references the toolchain schema directly, keeping the toolchain shape defined once and reused everywhere a pack declares its tool choices. Consumers of the corpus vendor these same files so their local `eep check` runs against the identical contract the corpus enforces.

## Contents

<!-- eep:index -->
- `law.schema.json`: validates law frontmatter (id, domain, title, status, maturity, severity, authors).
- `pack.schema.json`: validates pack manifests (name, kind, tier, detect rules, implements, toolchain).
- `toolchain.schema.json`: validates the toolchain block embedded in a pack manifest.
- `eep.schema.json`: validates a consumer's `eep.yaml` (profile and packs).
- `waivers.schema.json`: validates entries in a consumer's `.eep/waivers.yaml`.
<!-- /eep:index -->

## Related

Law IDs referenced by `implements`, `declines`, `supersedes`, and `related` fields across these schemas are validated by `law.schema.json`.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-01*
