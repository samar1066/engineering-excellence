import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { repoRoot } from "../src/lib/schema.js";
import { loadWaivers } from "../src/lib/waivers.js";

const TODAY = new Date("2026-08-15T00:00:00Z");

const JUSTIFICATION = "The upstream fix lands next sprint and the risk is contained.";

// Builds a target directory carrying only what loadWaivers reads: the vendored waivers schema.
function newTarget(): string {
  const dir = mkdtempSync(join(tmpdir(), "eep-waivers-"));
  const schemasDir = join(dir, ".eep", "schemas");
  mkdirSync(schemasDir, { recursive: true });
  copyFileSync(
    join(repoRoot(), "schemas", "waivers.schema.json"),
    join(schemasDir, "waivers.schema.json"),
  );
  return dir;
}

function writeWaivers(dir: string, yaml: string): void {
  writeFileSync(join(dir, ".eep", "waivers.yaml"), yaml);
}

describe("loadWaivers", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = newTarget();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns nothing at all when the file is missing", () => {
    const { active, problems } = loadWaivers(tmp, TODAY);

    expect(active).toEqual([]);
    expect(problems).toEqual([]);
  });

  it("returns a valid unexpired waiver as active", () => {
    writeWaivers(
      tmp,
      [
        "- law: EEP-DOCS-02",
        "  scope: docs/**",
        `  justification: "${JUSTIFICATION}"`,
        "  owner: '@owner-handle'",
        "  approved_by: '@approver-handle'",
        "  created: 2026-08-01",
        "  expires: 2026-11-01",
        "",
      ].join("\n"),
    );

    const { active, problems } = loadWaivers(tmp, TODAY);

    expect(problems).toEqual([]);
    expect(active).toHaveLength(1);
    expect(active[0]?.law).toBe("EEP-DOCS-02");
    expect(active[0]?.owner).toBe("@owner-handle");
    expect(active[0]?.expires).toBe("2026-11-01");
  });

  it("moves an expired waiver into problems", () => {
    writeWaivers(
      tmp,
      [
        "- law: EEP-DOCS-02",
        "  scope: docs/**",
        `  justification: "${JUSTIFICATION}"`,
        "  owner: '@owner-handle'",
        "  created: 2026-06-01",
        "  expires: 2026-07-01",
        "",
      ].join("\n"),
    );

    const { active, problems } = loadWaivers(tmp, TODAY);

    expect(active).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.detail).toContain("EEP-DOCS-02");
    expect(problems[0]?.detail).toContain("expired");
    expect(problems[0]?.detail).toContain("2026-07-01");
  });

  it("moves a malformed entry into problems", () => {
    writeWaivers(
      tmp,
      [
        "- law: EEP-DOCS-02",
        "  scope: docs/**",
        "  owner: '@owner-handle'",
        "  created: 2026-08-01",
        "  expires: 2026-11-01",
        "",
      ].join("\n"),
    );

    const { active, problems } = loadWaivers(tmp, TODAY);

    expect(active).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.detail).toContain("justification");
  });

  it("keeps valid entries active while reporting the invalid ones alongside them", () => {
    writeWaivers(
      tmp,
      [
        "- law: EEP-DOCS-02",
        "  scope: docs/**",
        `  justification: "${JUSTIFICATION}"`,
        "  owner: '@owner-handle'",
        "  created: 2026-08-01",
        "  expires: 2026-11-01",
        "- law: EEP-OBS-01",
        "  scope: app/**",
        `  justification: "${JUSTIFICATION}"`,
        "  owner: 'no-at-sign'",
        "  created: 2026-08-01",
        "  expires: 2026-11-01",
        "",
      ].join("\n"),
    );

    const { active, problems } = loadWaivers(tmp, TODAY);

    expect(active.map((waiver) => waiver.law)).toEqual(["EEP-DOCS-02"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.detail).toContain("owner");
  });

  it("reports a document that is not a list", () => {
    writeWaivers(tmp, "law: EEP-DOCS-02\n");

    const { active, problems } = loadWaivers(tmp, TODAY);

    expect(active).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.detail).toContain("list");
  });
});
