import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectPacks } from "../src/lib/detect.js";
import { repoRoot } from "../src/lib/schema.js";

function newTargetDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("detectPacks", () => {
  it("detects python-fastapi when pyproject.toml contains fastapi", () => {
    const dir = newTargetDir("eep-detect-match-");
    writeFileSync(join(dir, "pyproject.toml"), '[project]\ndependencies = ["fastapi"]\n');

    expect(detectPacks(dir, repoRoot())).toEqual(["python-fastapi"]);
  });

  it("detects nothing when pyproject.toml lacks the fastapi string", () => {
    const dir = newTargetDir("eep-detect-nomatch-");
    writeFileSync(join(dir, "pyproject.toml"), '[project]\ndependencies = ["django"]\n');

    expect(detectPacks(dir, repoRoot())).toEqual([]);
  });

  it("detects nothing in an empty directory", () => {
    const dir = newTargetDir("eep-detect-empty-");

    expect(detectPacks(dir, repoRoot())).toEqual([]);
  });
});
