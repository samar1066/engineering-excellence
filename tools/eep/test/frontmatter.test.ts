import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readFrontmatter } from "../src/lib/frontmatter.js";

describe("readFrontmatter", () => {
  it("parses yaml frontmatter and body", () => {
    const dir = mkdtempSync(join(tmpdir(), "eep-"));
    const p = join(dir, "doc.md");
    writeFileSync(p, "---\ntitle: X\nversion: 1.0.0\n---\n\n# X\n");
    const fm = readFrontmatter(p);
    expect(fm.data.title).toBe("X");
    expect(fm.body).toContain("# X");
  });
});
