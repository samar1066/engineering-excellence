import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fg from "fast-glob";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { repoRoot } from "../src/lib/schema.js";
import { vendorInto } from "../src/lib/vendor.js";

const root = repoRoot();

type ParsedLock = {
  program_version: string;
  profile: string;
  packs: { name: string; version: string }[];
  vendored: string;
};

function newTargetDir(): string {
  return mkdtempSync(join(tmpdir(), "eep-vendor-"));
}

async function lawFilesUnder(target: string): Promise<string[]> {
  return fg("*/laws/*.md", { cwd: join(target, ".eep", "doctrine") });
}

describe("vendorInto", () => {
  it("writes lock.yaml with the pinned shape", () => {
    const target = newTargetDir();
    vendorInto(target, root, ["python-fastapi"], "evolving");

    const lock = parseYaml(readFileSync(join(target, ".eep", "lock.yaml"), "utf8")) as ParsedLock;

    expect(lock.program_version).toBe("0.1.0");
    expect(lock.profile).toBe("evolving");
    expect(lock.packs[0]).toEqual({ name: "python-fastapi", version: "1.0.0" });
    expect(lock.vendored).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("vendors the constitution, the pack minus scaffold, and the profiles", () => {
    const target = newTargetDir();
    vendorInto(target, root, ["python-fastapi"], "evolving");

    const constitution = readFileSync(join(target, ".eep", "CONSTITUTION.md"), "utf8");
    expect(constitution).toContain("twelve tenets");

    const packDir = join(target, ".eep", "packs", "stack", "python-fastapi");
    expect(existsSync(join(packDir, "STACK.md"))).toBe(true);
    expect(existsSync(join(packDir, "scaffold"))).toBe(false);

    expect(existsSync(join(target, ".eep", "profiles", "greenfield.yaml"))).toBe(true);
  });

  it("vendors exactly the implemented law files, excluding declined ones", async () => {
    const target = newTargetDir();
    vendorInto(target, root, ["python-fastapi"], "evolving");

    const lawFiles = await lawFilesUnder(target);
    expect(lawFiles).toHaveLength(12);
    expect(lawFiles.some((file) => file.endsWith("EEP-DOCS-03.md"))).toBe(false);
  });

  it("is idempotent: re-vendoring with a different profile leaves a consistent tree, not a stale one", async () => {
    const target = newTargetDir();
    vendorInto(target, root, ["python-fastapi"], "evolving");

    expect(() => vendorInto(target, root, ["python-fastapi"], "greenfield")).not.toThrow();

    const lock = parseYaml(readFileSync(join(target, ".eep", "lock.yaml"), "utf8")) as ParsedLock;
    expect(lock.profile).toBe("greenfield");
    expect(lock.packs).toHaveLength(1);

    const packDir = join(target, ".eep", "packs", "stack", "python-fastapi");
    expect(existsSync(join(packDir, "STACK.md"))).toBe(true);
    expect(existsSync(join(packDir, "scaffold"))).toBe(false);

    const lawFiles = await lawFilesUnder(target);
    expect(lawFiles).toHaveLength(12);
  });

  it("carries an existing .eep/waivers.yaml across a re-vendor byte identically", () => {
    const target = newTargetDir();
    vendorInto(target, root, ["python-fastapi"], "evolving");

    // Deliberately not canonical YAML: a comment, single quotes, and no trailing newline, so a
    // parse-and-restring round trip would show up as a difference here even though the document
    // would still be semantically equal.
    const waiversPath = join(target, ".eep", "waivers.yaml");
    const waivers =
      "# approved 2026-08-01\n- law: EEP-DOCS-02\n  scope: '**/*.md'\n" +
      '  justification: "The imported vendor note is rewritten next sprint."\n' +
      "  owner: '@fixture-owner'\n  created: 2026-08-01\n  expires: 2026-11-01";
    writeFileSync(waiversPath, waivers);
    const before = readFileSync(waiversPath);

    vendorInto(target, root, ["python-fastapi"], "greenfield");

    expect(existsSync(waiversPath)).toBe(true);
    expect(readFileSync(waiversPath)).toEqual(before);
  });

  it("throws for a pack name that does not exist in the corpus", () => {
    const target = newTargetDir();
    expect(() => vendorInto(target, root, ["does-not-exist"], "evolving")).toThrow(
      "eep: pack does-not-exist not found in corpus",
    );
  });
});
