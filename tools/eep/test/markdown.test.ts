import { describe, expect, it } from "vitest";
import { scanMarkdownStyle } from "../src/lib/markdown.js";

// Banned characters are built from escapes here (rather than typed as literal glyphs) so this
// source file itself never embeds an em or en dash. The runtime string values are identical to
// the literal glyphs; only the source encoding differs.
const EM_DASH = "\u2014";
const EN_DASH = "\u2013";

describe("scanMarkdownStyle", () => {
  it("flags em and en dashes with line numbers", () => {
    const issues = scanMarkdownStyle(`ok line\nbad ${EM_DASH} line\nbad ${EN_DASH} too`);
    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatchObject({ line: 2, rule: "banned-dash" });
  });
  it("flags ordered lists starting at 0", () => {
    const issues = scanMarkdownStyle("0. first item\n1. second");
    expect(issues[0]).toMatchObject({ line: 1, rule: "zero-ordered-list" });
  });
  it("passes clean text with markdown syntax hyphens", () => {
    expect(scanMarkdownStyle("- bullet\n|---|---|\n1. one")).toHaveLength(0);
  });
});
