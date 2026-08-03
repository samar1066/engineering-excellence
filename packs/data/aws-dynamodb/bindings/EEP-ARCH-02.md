---
title: EEP-ARCH-02 binding
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-03
updated: 2026-08-03
---

## How this pack satisfies it

This pack ships a DynamoDB adapter for the note repository interface each backend pack already declares: `DynamoNoteRepository` for the python-fastapi `NoteRepository` abstract base class, and its TypeScript twin for the typescript-node `NoteRepository` interface. Each adapter accepts and returns the same domain entity the interface speaks in, so nothing above the interface learns that DynamoDB sits below it. The proof that the adapter is a true drop in for the in memory reference is a single contract suite, owned by the interface and describing the behavior it requires, that runs unchanged against both implementations: add then read back, read a missing id as absent, list what was added. The in memory reference and the DynamoDB adapter pointed at DynamoDB Local both run that identical suite and both pass it in full, which is what turns the interface into a seam the system can be cut along rather than an abstraction that still leaks the shape of one store. The dependency injection site is the one place the concrete adapter is named: swapping `MemoryNoteRepository()` for `DynamoNoteRepository()` in `app/api/deps.py` is the whole substitution, and the layers above never learn which one they received.

## The check

`bash scripts/contract-suite.sh` (see `checks/manifest.yaml`) brings up DynamoDB Local from the pinned compose file, then runs the contract suite twice in each language: once against the in memory reference and once against the DynamoDB adapter bound to the local endpoint. The Python suite runs under pytest and the TypeScript suite under vitest, and the script fails if either implementation in either language diverges from the contract. Running the suite only against the in memory reference is exactly the antipattern this law names, because it keeps the suite green while leaving the store that actually ships free to drift, so the check refuses to pass until the DynamoDB side has been exercised against a real local table.

## Notes for agents

When you add a method to the repository interface, add its behavior to the shared contract suite first, then make both implementations pass it, so the two never diverge on a behavior the interface claims to standardize. Keep storage specific behavior out of the adapter's public surface: do not let a DynamoDB result ordering or a partial write semantic leak through the interface, because the moment a caller depends on it the seam welds itself to one store. Bind the concrete repository in exactly one place, the dependency injection site, and let every layer above take the interface, so the choice of store stays a one line change that the contract suite has already vouched for.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-03*
