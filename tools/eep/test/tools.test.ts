import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectTools,
  formatToolSelection,
  parseToolSelection,
  readEepTools,
  resolveToolsNonInteractive,
} from "../src/lib/tools.js";

describe("parseToolSelection", () => {
  it("normalizes to canonical order, deduplicated, ignoring case and whitespace", () => {
    const { tools, unknown } = parseToolSelection([" Agents ", "claude", "CLAUDE"]);

    expect(tools).toEqual(["claude", "agents"]);
    expect(unknown).toEqual([]);
  });

  it("reports tokens that name no tool, without dropping the valid ones", () => {
    const { tools, unknown } = parseToolSelection(["claude", "cobol", "copilot"]);

    expect(tools).toEqual(["claude", "copilot"]);
    expect(unknown).toEqual(["cobol"]);
  });

  it("collapses to empty for none, and lets none dominate a mixed list", () => {
    expect(parseToolSelection(["none"]).tools).toEqual([]);
    expect(parseToolSelection(["claude", "none"]).tools).toEqual([]);
    // none is never itself reported as unknown.
    expect(parseToolSelection(["none"]).unknown).toEqual([]);
  });
});

describe("detectTools", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "eep-tools-detect-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("finds each tool by the file or directory it leaves, in canonical order", () => {
    writeFileSync(join(tmp, "CLAUDE.md"), "# ours\n");
    writeFileSync(join(tmp, "AGENTS.md"), "# ours\n");
    mkdirSync(join(tmp, ".github"), { recursive: true });
    writeFileSync(join(tmp, ".github", "copilot-instructions.md"), "# ours\n");
    mkdirSync(join(tmp, ".cursor", "rules"), { recursive: true });

    expect(detectTools(tmp)).toEqual(["claude", "copilot", "cursor", "agents"]);
  });

  it("returns nothing for a bare directory", () => {
    expect(detectTools(tmp)).toEqual([]);
  });
});

describe("readEepTools", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "eep-tools-read-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns null when eep.yaml is absent or carries no tools key", () => {
    expect(readEepTools(tmp)).toBeNull();
    writeFileSync(join(tmp, "eep.yaml"), "profile: evolving\npacks: [python-fastapi]\n");
    expect(readEepTools(tmp)).toBeNull();
  });

  it("distinguishes a present but empty selection (none) from an absent one", () => {
    writeFileSync(join(tmp, "eep.yaml"), "profile: evolving\npacks: []\ntools: []\n");
    expect(readEepTools(tmp)).toEqual([]);
  });

  it("reads and normalizes a recorded selection", () => {
    writeFileSync(join(tmp, "eep.yaml"), "tools:\n  - agents\n  - claude\n");
    expect(readEepTools(tmp)).toEqual(["claude", "agents"]);
  });
});

describe("resolveToolsNonInteractive precedence", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "eep-tools-resolve-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("keeps a stored selection over anything the files imply", () => {
    writeFileSync(join(tmp, "eep.yaml"), "tools: [cursor]\n");
    writeFileSync(join(tmp, "CLAUDE.md"), "# ours\n");

    expect(resolveToolsNonInteractive(tmp)).toEqual(["cursor"]);
  });

  it("falls back to detection when there is no stored selection", () => {
    writeFileSync(join(tmp, "CLAUDE.md"), "# ours\n");

    expect(resolveToolsNonInteractive(tmp)).toEqual(["claude"]);
  });

  it("falls back to the AGENTS.md baseline for a bare directory", () => {
    expect(resolveToolsNonInteractive(tmp)).toEqual(["agents"]);
  });
});

describe("formatToolSelection", () => {
  it("joins the tokens, or says none for the empty selection", () => {
    expect(formatToolSelection(["claude", "agents"])).toBe("claude, agents");
    expect(formatToolSelection([])).toBe("none");
  });
});
