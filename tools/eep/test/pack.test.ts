import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadPack, validatePack } from "../src/lib/pack.js";
import { repoRoot } from "../src/lib/schema.js";

const packDir = join(repoRoot(), "packs/stack/python-fastapi");

function writeFixtureFile(root: string, relPath: string, content: string): void {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

// Every fixture pack lives under its own temp root with a sentinel eep.yaml so repoRoot(), called
// internally by validatePack with the pack dir as its search start, resolves to the fixture root
// instead of walking up into this actual corpus checkout.
function newFixtureRoot(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

const FIXTURE_AUTHORS = `authors:
  - { name: Fixture Author, github: "@fixture-author" }
maintainers: ["@fixture-author"]`;

function lawFixture(id: string, appliesTo: string, statement: string): string {
  return `---
id: ${id}
applies_to: [${appliesTo}]
---

## Statement

${statement}

## Rationale

Fixture rationale text for ${id}.
`;
}

function bindingFixture(id: string, body: string): string {
  return `---
title: ${id} binding
version: 1.0.0
---

## How this stack satisfies it

${body}
`;
}

// Builds a pack with one law fully in order: implemented, bound, checked, covered, and a binding
// that explains the law without repeating its statement, plus a self-contained README. Used to
// prove validatePack can return zero violations, since the real pack cannot yet (see below).
function buildCleanPack(): string {
  const root = newFixtureRoot("eep-pack-clean-");
  writeFixtureFile(root, "eep.yaml", "");
  writeFixtureFile(
    root,
    "doctrine/fixture/laws/EEP-FXC-01.md",
    lawFixture("EEP-FXC-01", "all", "Fixture fixtures must stay observable end to end."),
  );
  writeFixtureFile(
    root,
    "packs/stack/clean-pack/pack.yaml",
    `name: clean-pack
kind: stack
version: 1.0.0
tier: 1
source: builtin
detect:
  - file: pyproject.toml
requires: []
implements:
  - EEP-FXC-01
declines: []
toolchain: {}
${FIXTURE_AUTHORS}
`,
  );
  writeFixtureFile(
    root,
    "packs/stack/clean-pack/checks/manifest.yaml",
    `checks:
  - law: EEP-FXC-01
    kind: shell
    command: "true"
    proves: "Fixture proof text for the clean pack."
`,
  );
  writeFixtureFile(
    root,
    "packs/stack/clean-pack/bindings/EEP-FXC-01.md",
    bindingFixture(
      "EEP-FXC-01",
      "This fixture stack keeps its behavior observable through its own tooling, without " +
        "repeating the doctrine wording.",
    ),
  );
  writeFixtureFile(
    root,
    "packs/stack/clean-pack/README.md",
    "# clean-pack\n\nSee the [EEP-FXC-01 binding](bindings/EEP-FXC-01.md) for details.\n",
  );
  return join(root, "packs/stack/clean-pack");
}

// Builds one pack that trips every assertion except the README link containment one (which needs
// a README.md to be present to have links in the first place, so it gets its own fixture below):
// an invalid tier, a law implemented without a binding or checks entry, a checks entry for a law
// never declared as implemented, a doctrine law covered by neither implements nor declines, a
// second doctrine law correctly left out of scope for coverage, a toolchain config pointing at a
// file that does not exist, a binding that restates its law's statement (across a line break and
// extra spaces, so only a whitespace-normalized comparison catches it), and no README.md at all.
function buildDirtyPack(): string {
  const root = newFixtureRoot("eep-pack-dirty-");
  writeFixtureFile(root, "eep.yaml", "");
  writeFixtureFile(
    root,
    "doctrine/fixture/laws/EEP-FX-01.md",
    lawFixture("EEP-FX-01", "all", "Fixture behavior must always be observable end to end."),
  );
  writeFixtureFile(
    root,
    "doctrine/fixture/laws/EEP-FX-02.md",
    lawFixture("EEP-FX-02", "backend", "Every fixture module logs its own boundary crossing."),
  );
  writeFixtureFile(
    root,
    "doctrine/fixture/laws/EEP-FX-03.md",
    lawFixture("EEP-FX-03", "frontend", "Fixture frontend components declare their own tests."),
  );
  writeFixtureFile(
    root,
    "packs/stack/dirty-pack/pack.yaml",
    `name: dirty-pack
kind: stack
version: 1.0.0
tier: 3
source: builtin
detect:
  - file: pyproject.toml
requires: []
implements:
  - EEP-FX-01
  - EEP-FX-04
declines: []
toolchain:
  formatter: { tool: fixture-fmt, config: templates/config/missing.toml, rationale: "Fixture rationale for toolchain." }
${FIXTURE_AUTHORS}
`,
  );
  writeFixtureFile(
    root,
    "packs/stack/dirty-pack/checks/manifest.yaml",
    `checks:
  - law: EEP-FX-01
    kind: shell
    command: "true"
    proves: "Fixture proof text for FX-01."
  - law: EEP-FX-05
    kind: shell
    command: "true"
    proves: "Fixture proof text for FX-05, which is not implemented."
`,
  );
  // Deliberately spaced/wrapped differently than the law's own statement sentence: an unnormalized
  // substring check would miss this, a whitespace-normalized one must not.
  writeFixtureFile(
    root,
    "packs/stack/dirty-pack/bindings/EEP-FX-01.md",
    bindingFixture(
      "EEP-FX-01",
      "Fixture   behavior must always be observable\nend to end. That is why every fixture " +
        "module logs continuously.",
    ),
  );
  // No bindings/EEP-FX-04.md, no checks entry for EEP-FX-04, and no README.md at all.
  return join(root, "packs/stack/dirty-pack");
}

// A minimal, otherwise-clean pack whose README.md exists but links outside the pack directory, to
// isolate the standalone-readme rule from missing-readme (a file cannot be both missing and have
// an offending link at once).
function buildEscapeReadmePack(): string {
  const root = newFixtureRoot("eep-pack-escape-");
  writeFixtureFile(root, "eep.yaml", "");
  writeFixtureFile(
    root,
    "doctrine/fixture/laws/EEP-FXE-01.md",
    lawFixture("EEP-FXE-01", "all", "Fixture escape pack always logs cleanly."),
  );
  writeFixtureFile(
    root,
    "packs/stack/escape-pack/pack.yaml",
    `name: escape-pack
kind: stack
version: 1.0.0
tier: 1
source: builtin
detect:
  - file: pyproject.toml
requires: []
implements:
  - EEP-FXE-01
declines: []
toolchain: {}
${FIXTURE_AUTHORS}
`,
  );
  writeFixtureFile(
    root,
    "packs/stack/escape-pack/checks/manifest.yaml",
    `checks:
  - law: EEP-FXE-01
    kind: shell
    command: "true"
    proves: "Fixture proof text for the escape pack."
`,
  );
  writeFixtureFile(
    root,
    "packs/stack/escape-pack/bindings/EEP-FXE-01.md",
    bindingFixture("EEP-FXE-01", "This fixture stack explains the law without quoting it."),
  );
  writeFixtureFile(
    root,
    "packs/stack/escape-pack/README.md",
    "# escape-pack\n\nSee [outside](../outside.md) for more.\n",
  );
  return join(root, "packs/stack/escape-pack");
}

describe("pack contract", () => {
  it("loads the real pack", () => {
    const pack = loadPack(packDir);
    expect(pack.name).toBe("python-fastapi");
    expect(pack.checks.length).toBeGreaterThan(0);
  });

  it("the real pack passes the contract", async () => {
    const violations = await validatePack(packDir);
    // packs/stack/python-fastapi/README.md and STACK.md are owned by a parallel task in this same
    // wave and may not exist yet at the moment this runs. The wave gate enforces zero violations
    // (missing-readme/standalone-readme included) once that task lands; until then, tolerate only
    // those two rules here so this test does not depend on task interleaving.
    const unexpected = violations.filter(
      (v) => v.rule !== "missing-readme" && v.rule !== "standalone-readme",
    );
    expect(unexpected).toEqual([]);
  });

  it("loads pack fields from a fixture pack", () => {
    const dir = buildCleanPack();
    const pack = loadPack(dir);
    expect(pack.name).toBe("clean-pack");
    expect(pack.dir).toBe(dir);
    expect(pack.manifest.kind).toBe("stack");
    expect(pack.checks).toEqual([
      {
        law: "EEP-FXC-01",
        kind: "shell",
        command: "true",
        proves: "Fixture proof text for the clean pack.",
      },
    ]);
  });

  it("passes a fully compliant fixture pack with zero violations", async () => {
    const dir = buildCleanPack();
    const violations = await validatePack(dir);
    expect(violations).toEqual([]);
  });

  it("reports one violation per broken assertion on a fixture pack", async () => {
    const dir = buildDirtyPack();
    const violations = await validatePack(dir);

    expect(violations.find((v) => v.rule === "pack-schema")).toBeDefined();

    const bindingMissing = violations.find((v) => v.rule === "binding-missing");
    expect(bindingMissing?.detail).toContain("EEP-FX-04");

    const checksEntryMissing = violations.find((v) => v.rule === "checks-entry-missing");
    expect(checksEntryMissing?.detail).toContain("EEP-FX-04");

    const checksEntryUnlisted = violations.find((v) => v.rule === "checks-entry-unlisted");
    expect(checksEntryUnlisted?.detail).toContain("EEP-FX-05");

    const lawCoverage = violations.filter((v) => v.rule === "law-coverage");
    expect(lawCoverage).toHaveLength(1);
    expect(lawCoverage[0]?.detail).toContain("EEP-FX-02");
    // EEP-FX-03 only applies to "frontend", outside the coverage filter, so it must never surface.
    expect(violations.some((v) => v.detail.includes("EEP-FX-03"))).toBe(false);

    const toolchainMissing = violations.find((v) => v.rule === "toolchain-config-missing");
    expect(toolchainMissing?.detail).toContain("templates/config/missing.toml");

    const restated = violations.find((v) => v.rule === "statement-restated");
    expect(restated?.detail).toContain("EEP-FX-01");

    const missingReadme = violations.find((v) => v.rule === "missing-readme");
    expect(missingReadme).toBeDefined();

    expect(violations.some((v) => v.rule === "standalone-readme")).toBe(false);
  });

  it("flags a README link that escapes the pack directory", async () => {
    const dir = buildEscapeReadmePack();
    const violations = await validatePack(dir);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ rule: "standalone-readme", line: 3 });
    expect(violations[0]?.detail).toContain("outside.md");
  });
});
