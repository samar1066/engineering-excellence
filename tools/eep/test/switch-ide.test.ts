import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import { runAdopt } from "../src/commands/adopt.js";
import { runSwitchIde } from "../src/commands/switch-ide.js";
import { BLOCK_BEGIN_PREFIX } from "../src/lib/managed-block.js";
import { repoRoot } from "../src/lib/schema.js";

const corpusDir = repoRoot();

const CLAUDE = "CLAUDE.md";
const AGENTS = "AGENTS.md";
const COPILOT = ".github/copilot-instructions.md";
const CURSOR = ".cursor/rules/eep.mdc";

async function captureLog(run: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(" "));
  });
  try {
    await run();
  } finally {
    spy.mockRestore();
  }
  return lines.join("\n");
}

// A repository adopted under an explicit tool selection, ready to be switched. runAdopt warns about
// the missing .git and carries on, which is all this needs: a vendored .eep, an eep.yaml recording
// the selection, and the surfaces that selection writes.
async function adoptWith(prefix: string, tools: string[]): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(dir, "pyproject.toml"), '[project]\ndependencies = ["fastapi"]\n');
  await captureLog(async () => {
    await runAdopt({ targetDir: dir, corpusDir, profile: "evolving", yes: true, tools });
  });
  return dir;
}

function toolsInYaml(dir: string): unknown {
  return parseYaml(readFileSync(join(dir, "eep.yaml"), "utf8")).tools;
}

describe("runSwitchIde", () => {
  let tmp: string;

  afterEach(() => {
    if (tmp !== undefined) rmSync(tmp, { recursive: true, force: true });
  });

  /**
   * The core switch: from Claude to Cursor. The Cursor rule appears, the CLAUDE.md block is stripped,
   * and the team's own prose above and below the block survives byte for byte.
   */
  it("switches from claude to cursor, creating the rule and stripping the CLAUDE.md block", async () => {
    tmp = await adoptWith("eep-switch-claude-", ["claude"]);
    const preface = "# House rules\n\nDeploys go out on Thursdays.\n";
    const epilogue = "\n## Local conventions\n\nRun make dev first.\n";
    const generated = readFileSync(join(tmp, CLAUDE), "utf8");
    writeFileSync(join(tmp, CLAUDE), `${preface}\n${generated}${epilogue}`);

    const result = await captureLog(async () => {
      const out = await runSwitchIde({ targetDir: tmp, tools: ["cursor"] });
      expect(out).toEqual({ before: ["claude"], after: ["cursor"] });
    });

    expect(existsSync(join(tmp, CURSOR))).toBe(true);
    const claude = readFileSync(join(tmp, CLAUDE), "utf8");
    // The bytes the team wrote, above and below the block, are still there; only eep's block is gone.
    expect(claude.startsWith(preface)).toBe(true);
    expect(claude).toContain("Run make dev first.");
    expect(claude).not.toContain(BLOCK_BEGIN_PREFIX);
    expect(toolsInYaml(tmp)).toEqual(["cursor"]);
    void result;
  });

  it("deletes a wholly generated CLAUDE.md when claude is switched away", async () => {
    tmp = await adoptWith("eep-switch-delete-", ["claude"]);
    expect(existsSync(join(tmp, CLAUDE))).toBe(true);

    await captureLog(async () => {
      await runSwitchIde({ targetDir: tmp, tools: ["copilot"] });
    });

    expect(existsSync(join(tmp, CLAUDE))).toBe(false);
    expect(existsSync(join(tmp, COPILOT))).toBe(true);
  });

  it("sets exactly the named set, adding and removing surfaces together", async () => {
    tmp = await adoptWith("eep-switch-set-", ["claude", "agents"]);

    await captureLog(async () => {
      await runSwitchIde({ targetDir: tmp, tools: ["agents", "copilot"] });
    });

    expect(toolsInYaml(tmp)).toEqual(["copilot", "agents"]);
    expect(existsSync(join(tmp, AGENTS))).toBe(true);
    expect(existsSync(join(tmp, COPILOT))).toBe(true);
    expect(existsSync(join(tmp, CLAUDE))).toBe(false);
  });

  it("prints the before and after tool sets and the files written and removed", async () => {
    tmp = await adoptWith("eep-switch-print-", ["claude"]);

    const output = await captureLog(async () => {
      await runSwitchIde({ targetDir: tmp, tools: ["cursor"] });
    });

    expect(output).toContain("eep switch-ide: tools before: claude");
    expect(output).toContain("eep switch-ide: tools after: cursor");
    expect(output).toContain(".cursor/rules/eep.mdc");
    expect(output).toContain("CLAUDE.md");
  });

  it("is idempotent: switching to the current set again changes no bytes", async () => {
    tmp = await adoptWith("eep-switch-idem-", ["claude", "cursor"]);
    const before = [
      readFileSync(join(tmp, CLAUDE), "utf8"),
      readFileSync(join(tmp, CURSOR), "utf8"),
    ];

    await captureLog(async () => {
      await runSwitchIde({ targetDir: tmp, tools: ["claude", "cursor"] });
    });

    expect([
      readFileSync(join(tmp, CLAUDE), "utf8"),
      readFileSync(join(tmp, CURSOR), "utf8"),
    ]).toEqual(before);
  });

  it("throws when there is no vendored .eep to switch within", async () => {
    tmp = mkdtempSync(join(tmpdir(), "eep-switch-noeep-"));

    await expect(runSwitchIde({ targetDir: tmp, tools: ["cursor"] })).rejects.toThrow(
      "run eep adopt first",
    );
  });

  it("rejects an unknown tool token", async () => {
    tmp = await adoptWith("eep-switch-badtool-", ["claude"]);

    await expect(runSwitchIde({ targetDir: tmp, tools: ["cobol"] })).rejects.toThrow(
      /unknown tool: cobol/,
    );
  });
});
