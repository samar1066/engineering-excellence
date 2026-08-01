import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runExplain } from "../src/commands/explain.js";
import { repoRoot } from "../src/lib/schema.js";
import { vendorInto } from "../src/lib/vendor.js";

const root = repoRoot();

describe("runExplain", () => {
  it("returns the law body plus the pack binding when run inside the corpus", () => {
    const text = runExplain("EEP-SEC-01", root);

    expect(text).toContain("## Statement");
    expect(text).toContain("Secrets never enter version control");
    expect(text).toContain("secrets-scan");
  });

  it("strips the frontmatter of both the law and the binding", () => {
    const text = runExplain("EEP-SEC-01", root);

    expect(text).not.toContain("applies_to:");
    expect(text).not.toContain("EEP-SEC-01 binding");
  });

  it("reads a vendored .eep tree when one exists", () => {
    const target = mkdtempSync(join(tmpdir(), "eep-explain-"));
    try {
      vendorInto(target, root, ["python-fastapi"], "greenfield");

      const text = runExplain("EEP-DEVX-01", target);

      expect(text).toContain("## Statement");
      expect(text).toContain("## How this stack satisfies it");
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it("throws listing the known ids for an unknown law", () => {
    expect(() => runExplain("EEP-NOPE-99", root)).toThrow("EEP-TEST-03");
  });

  it("lists the known ids in sorted order", () => {
    let message = "";
    try {
      runExplain("EEP-NOPE-99", root);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    const ids = message.split(/\s+/).filter((token) => /^EEP-[A-Z]+-\d+/.test(token));
    const cleaned = ids.map((id) => id.replace(/[,;]$/, "")).filter((id) => id !== "EEP-NOPE-99");

    expect(cleaned.length).toBeGreaterThan(5);
    expect(cleaned).toEqual([...cleaned].sort((a, b) => a.localeCompare(b)));
  });
});
