import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateCorpus } from "../src/commands/corpus.js";

// Built from an escape (not a literal glyph) so this source file never embeds a banned dash.
// The fixture file written to disk below does contain the real character on purpose: that file
// is the thing under test, not this test's own source.
const EM_DASH = "\u2014";

function writeFixtureFile(root: string, relPath: string, content: string): void {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

const SIMPLE_README =
  "---\ntitle: Fixture\nversion: 1.0.0\n---\n\n# Fixture\n\nPlaceholder content.\n";

// created/updated are deliberately unquoted YAML dates (parsed by gray-matter into JS Date
// objects) so this fixture also exercises corpus.ts normalizing them to ISO date strings before
// schema validation. Without that normalization this "good" file would itself fail validation.
const GOOD_LAW = `---
id: EEP-TEST-01
domain: TEST
title: Fixture law used to verify corpus validation end to end
version: 1.0.0
status: stable
maturity: standard
severity: advisory
applies_to: [all]
authors:
  - { name: Fixture Author, github: "@fixture-author" }
maintainers: ["@fixture-author"]
created: 2026-08-01
updated: 2026-08-01
---

## Statement

Fixture statement.

## Rationale

Fixture rationale.

## Pattern

Fixture pattern.

## Antipatterns

Fixture antipatterns.

## Check contract

Fixture check contract.

## Waiver policy

Fixture waiver policy.
`;

const LAW_MISSING_HEADING = `---
id: EEP-TEST-02
domain: TEST
title: Fixture law missing its waiver policy heading on purpose
version: 1.0.0
status: stable
maturity: standard
severity: advisory
applies_to: [all]
authors:
  - { name: Fixture Author, github: "@fixture-author" }
maintainers: ["@fixture-author"]
created: 2026-08-01
updated: 2026-08-01
---

## Statement

Fixture statement.

## Rationale

Fixture rationale.

## Pattern

Fixture pattern.

## Antipatterns

Fixture antipatterns.

## Check contract

Fixture check contract.
`;

// Genuinely malformed YAML: the "[all" flow sequence on applies_to is never closed, which makes
// gray-matter/js-yaml throw a YAMLException while parsing this file's frontmatter block. This
// exercises the try/catch in checkLawFile that turns that throw into a single reported violation
// instead of letting it propagate out of validateCorpus and abort the whole run.
const LAW_MALFORMED_YAML = `---
id: EEP-TEST-03
domain: TEST
title: Fixture law with malformed YAML frontmatter on purpose
version: 1.0.0
status: stable
maturity: standard
severity: advisory
applies_to: [all
authors:
  - { name: Fixture Author, github: "@fixture-author" }
maintainers: ["@fixture-author"]
created: 2026-08-01
updated: 2026-08-01
---

## Statement

Fixture statement.
`;

function buildFixtureCorpus(): string {
  const root = mkdtempSync(join(tmpdir(), "eep-corpus-"));
  writeFixtureFile(root, "doctrine/README.md", SIMPLE_README);
  writeFixtureFile(root, "doctrine/test/README.md", SIMPLE_README);
  writeFixtureFile(root, "doctrine/test/laws/EEP-TEST-01.md", GOOD_LAW);
  writeFixtureFile(root, "doctrine/test/laws/EEP-TEST-02.md", LAW_MISSING_HEADING);
  writeFixtureFile(root, "doctrine/test/laws/EEP-TEST-03.md", LAW_MALFORMED_YAML);
  writeFixtureFile(
    root,
    "notes/style-bad.md",
    `# Notes\n\nThis line is fine.\nThis line has a bad ${EM_DASH} dash in it.\n`,
  );
  writeFixtureFile(root, "packs/README.md", SIMPLE_README);
  writeFixtureFile(root, "packs/stack/README.md", SIMPLE_README);
  writeFixtureFile(root, "packs/stack/demo-pack/README.md", SIMPLE_README);
  writeFixtureFile(
    root,
    "packs/stack/demo-pack/file.md",
    "# Demo pack file\n\nSee EEP-TEST-01 for details.\n\n[bad link](../../escape.md)\n",
  );
  return root;
}

describe("validateCorpus", () => {
  it("reports style, law-heading, parse-error, and pack-containment violations without aborting, and passes the good law file", async () => {
    const root = buildFixtureCorpus();
    // If checkLawFile let the YAMLException from the malformed-frontmatter fixture propagate,
    // this call would reject and every assertion below would never run. Reaching past it, and
    // still finding the other three fixtures' violations, is itself proof the run did not abort.
    const violations = await validateCorpus(root);

    const dashViolation = violations.find((v) => v.rule === "banned-dash");
    expect(dashViolation?.path).toContain("style-bad.md");

    const headingViolation = violations.find((v) => v.rule === "law-headings");
    expect(headingViolation?.path).toContain("EEP-TEST-02.md");
    expect(headingViolation?.detail).toContain("Waiver policy");

    const containmentViolation = violations.find((v) => v.rule === "pack-containment");
    expect(containmentViolation?.path).toContain("demo-pack");
    expect(containmentViolation?.detail).toContain("escape.md");

    const parseErrorViolation = violations.find((v) => v.rule === "law-parse-error");
    expect(parseErrorViolation?.path).toContain("EEP-TEST-03.md");
    expect(parseErrorViolation?.line).toBe(1);
    // Concise: a single line, not js-yaml's full message-plus-snippet-plus-caret block.
    expect(parseErrorViolation?.detail).toBeTruthy();
    expect(parseErrorViolation?.detail).not.toContain("\n");

    // The good law file (valid frontmatter with YAML dates, correct filename, all six headings)
    // must not contribute any violation of its own.
    expect(violations.filter((v) => v.path.includes("EEP-TEST-01.md"))).toHaveLength(0);

    // Every content directory created above (doctrine/, doctrine/test/, packs/, packs/stack/,
    // packs/stack/demo-pack/) ships its own README.md, so this must stay empty.
    expect(violations.filter((v) => v.rule === "missing-readme")).toHaveLength(0);

    // Confirms the Date-to-ISO-string normalization actually ran for both well-formed law files,
    // and that the malformed one stopped at law-parse-error rather than also reporting these.
    expect(violations.filter((v) => v.rule === "law-frontmatter")).toHaveLength(0);
    expect(violations.filter((v) => v.rule === "law-filename")).toHaveLength(0);

    expect(violations).toHaveLength(4);
  });

  // The kind directory level (packs/stack/) is required as well as packs/ and each concrete pack,
  // so removing its README is a reported violation rather than a silent gap.
  it("reports a missing README on a pack kind directory", async () => {
    const root = buildFixtureCorpus();
    rmSync(join(root, "packs", "stack", "README.md"));

    const violations = await validateCorpus(root);

    const missing = violations.filter((v) => v.rule === "missing-readme");
    expect(missing).toHaveLength(1);
    expect(missing[0]?.path).toBe("packs/stack/README.md");
  });
});
