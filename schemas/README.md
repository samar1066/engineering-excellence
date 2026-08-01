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

None of these schemas share a law ID field by reference. Each schema that holds a law ID shaped value constrains it with its own inline `^EEP-` prefix pattern: `implements` and `declines.law` in `pack.schema.json`, `related` in `law.schema.json`, and `law` in `waivers.schema.json`. The `supersedes` field in `law.schema.json` carries no pattern at all. Only the `id` field inside `law.schema.json` enforces the full law ID shape, the pattern `^EEP-[A-Z]{2,5}-[0-9]{2}$`. The one genuine reference between these schema files is `pack.schema.json`, whose `toolchain` property points at `toolchain.schema.json` with `$ref`.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-01*
