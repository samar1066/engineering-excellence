import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { bundledCorpusDir, corpusRoot } from "../src/lib/corpus-root.js";
import { repoRoot } from "../src/lib/schema.js";

// Resolved from this file's own location, not from the cwd, so the expectation itself survives
// the chdir the test below performs.
const expectedRoot = repoRoot(dirname(fileURLToPath(import.meta.url)));

describe("corpusRoot", () => {
  const originalCwd = process.cwd();
  let tmp: string | undefined;

  afterEach(() => {
    process.chdir(originalCwd);
    if (tmp !== undefined) rmSync(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  it("returns the corpus root even when the process is running from a temp directory", () => {
    tmp = mkdtempSync(join(tmpdir(), "eep-corpus-root-"));
    process.chdir(tmp);

    const resolved = corpusRoot();

    expect(resolved).toBe(expectedRoot);
    expect(resolved).not.toBe(process.cwd());
    expect(existsSync(join(resolved, "eep.yaml"))).toBe(true);
    expect(existsSync(join(resolved, "packs"))).toBe(true);
  });

  it("falls back to repoRoot when no ancestor of the start file carries both corpus markers", () => {
    tmp = mkdtempSync(join(tmpdir(), "eep-corpus-root-bundled-"));

    // A start file with no eep.yaml plus packs pair anywhere above it, so the walk exhausts and
    // the fallback answers instead. repoRoot reads the cwd, which is still the corpus checkout.
    expect(corpusRoot(join(tmp, "index.js"))).toBe(expectedRoot);
  });

  it("finds the corpus bundled beside the module directory before falling back", () => {
    tmp = mkdtempSync(join(tmpdir(), "eep-corpus-root-package-"));
    const distDir = makeBundledPackage(tmp, "eep.yaml");

    const resolved = corpusRoot(join(distDir, "index.js"));

    expect(resolved).toBe(join(tmp, "corpus"));
    expect(resolved).not.toBe(expectedRoot);
  });
});

// Shapes the layout an installed npm package has: <package>/dist/index.js beside <package>/corpus.
// Returns the dist directory, which is the module directory the probe is anchored on at runtime.
function makeBundledPackage(packageDir: string, marker: "eep.yaml" | "CONSTITUTION.md"): string {
  const distDir = join(packageDir, "dist");
  const corpusDir = join(packageDir, "corpus");
  mkdirSync(distDir, { recursive: true });
  mkdirSync(join(corpusDir, "packs"), { recursive: true });
  writeFileSync(join(corpusDir, marker), "packs: []\n");
  return distDir;
}

describe("bundledCorpusDir", () => {
  let tmp: string | undefined;

  afterEach(() => {
    if (tmp !== undefined) rmSync(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  it("resolves the sibling corpus directory from the module directory", () => {
    tmp = mkdtempSync(join(tmpdir(), "eep-bundled-yaml-"));
    const distDir = makeBundledPackage(tmp, "eep.yaml");

    expect(bundledCorpusDir(distDir)).toBe(join(tmp, "corpus"));
  });

  it("accepts CONSTITUTION.md as the second marker", () => {
    tmp = mkdtempSync(join(tmpdir(), "eep-bundled-constitution-"));
    const distDir = makeBundledPackage(tmp, "CONSTITUTION.md");

    expect(bundledCorpusDir(distDir)).toBe(join(tmp, "corpus"));
  });

  it("returns null when the sibling corpus is missing or incomplete", () => {
    tmp = mkdtempSync(join(tmpdir(), "eep-bundled-missing-"));
    const distDir = join(tmp, "dist");
    mkdirSync(distDir, { recursive: true });

    expect(bundledCorpusDir(distDir)).toBeNull();

    // packs alone is not a corpus: without eep.yaml or CONSTITUTION.md there is nothing to
    // vendor a constitution or a profile set from.
    mkdirSync(join(tmp, "corpus", "packs"), { recursive: true });
    expect(bundledCorpusDir(distDir)).toBeNull();
  });
});
