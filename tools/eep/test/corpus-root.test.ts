import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { corpusRoot } from "../src/lib/corpus-root.js";
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
});
