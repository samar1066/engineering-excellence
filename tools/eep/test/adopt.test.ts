import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import { installGitHook, plannedFiles, runAdopt } from "../src/commands/adopt.js";
import { AUTHORITY_SENTENCE, BLOCK_BEGIN, BLOCK_END } from "../src/lib/managed-block.js";
import { repoRoot } from "../src/lib/schema.js";
import type { ToolToken } from "../src/lib/tools.js";

const corpusDir = repoRoot();

// The CLAUDE.md and AGENTS.md pair, the selection most of these fixtures adopt under so the co owned
// block assertions below still hold. Fresh repos with no prior selection would otherwise resolve to
// the AGENTS.md baseline alone.
const PAIR: ToolToken[] = ["claude", "agents"];

function newTargetDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

// Collected into an array rather than read off the spy afterwards: mockRestore clears the recorded
// calls, so a spy read after it has been restored reports nothing at all.
async function captureLogs(run: () => Promise<void> | void): Promise<string[]> {
  const lines: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(" "));
  });
  try {
    await run();
  } finally {
    log.mockRestore();
  }
  return lines;
}

// The one sanctioned git use in this suite: initializing a throwaway fixture directory under the
// OS temp dir so adopt has a real .git to install its hook into. This never touches the corpus
// repository itself.
async function gitInit(dir: string): Promise<void> {
  await execa("git", ["init"], { cwd: dir });
}

function writeFastApiPyproject(dir: string): void {
  writeFileSync(join(dir, "pyproject.toml"), '[project]\ndependencies = ["fastapi"]\n');
}

describe("runAdopt", () => {
  it("adopts a git repo with a detected pack: vendors, generates, and installs the hook", async () => {
    const targetDir = newTargetDir("eep-adopt-git-");
    await gitInit(targetDir);
    writeFastApiPyproject(targetDir);

    const result = await runAdopt({
      targetDir,
      corpusDir,
      profile: "evolving",
      yes: true,
      tools: PAIR,
    });

    expect(result.packs).toEqual(["python-fastapi"]);
    expect(result.tools).toEqual(PAIR);
    expect(existsSync(join(targetDir, ".eep", "lock.yaml"))).toBe(true);
    expect(existsSync(join(targetDir, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(targetDir, "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(targetDir, "eep.yaml"))).toBe(true);

    const hookPath = join(targetDir, ".git", "hooks", "pre-commit");
    expect(existsSync(hookPath)).toBe(true);
    expect(statSync(hookPath).mode & 0o111).not.toBe(0);
    const hookContent = readFileSync(hookPath, "utf8");
    expect(hookContent).toContain("eep verify --changed");
    // The npx only consumer never has a bare `eep` on PATH; the hook must fall back to the
    // published package rather than failing the commit outright.
    expect(hookContent).toContain("npx -y engineering-excellence");
  });

  it("adopts a plain directory without git: resolves, writes artifacts, installs no hook", async () => {
    const targetDir = newTargetDir("eep-adopt-nogit-");
    writeFastApiPyproject(targetDir);

    const result = await runAdopt({
      targetDir,
      corpusDir,
      profile: "evolving",
      yes: true,
      tools: PAIR,
    });

    expect(result.packs).toEqual(["python-fastapi"]);
    expect(existsSync(join(targetDir, ".eep", "lock.yaml"))).toBe(true);
    expect(existsSync(join(targetDir, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(targetDir, "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(targetDir, "eep.yaml"))).toBe(true);
    expect(existsSync(join(targetDir, ".git"))).toBe(false);
  });

  it("adopts a worktree style directory where .git is a file: resolves, installs no hook", async () => {
    const targetDir = newTargetDir("eep-adopt-worktree-");
    writeFileSync(join(targetDir, ".git"), "gitdir: /elsewhere\n");
    writeFastApiPyproject(targetDir);

    const result = await runAdopt({
      targetDir,
      corpusDir,
      profile: "evolving",
      yes: true,
      tools: PAIR,
    });

    expect(result.packs).toEqual(["python-fastapi"]);
    expect(existsSync(join(targetDir, ".eep", "lock.yaml"))).toBe(true);
    expect(existsSync(join(targetDir, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(targetDir, "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(targetDir, "eep.yaml"))).toBe(true);
    expect(existsSync(join(targetDir, ".git", "hooks", "pre-commit"))).toBe(false);
  });

  // Asserted as "the message names the supported packs", not as a fixed list: the list is every
  // pack the corpus carries, so pinning it to today's corpus would turn this red every time a pack
  // lands, for a reason that has nothing to do with what it is testing.
  it("rejects when no pack is detected, naming the supported packs", async () => {
    const targetDir = newTargetDir("eep-adopt-nomatch-");

    await expect(
      runAdopt({ targetDir, corpusDir, profile: "evolving", yes: true }),
    ).rejects.toThrow(/no pack detected; supported packs: .*python-fastapi/);
  });

  it("writes eep.yaml that parses to the profile, detected packs, and tool selection", async () => {
    const targetDir = newTargetDir("eep-adopt-yaml-");
    writeFastApiPyproject(targetDir);

    await runAdopt({ targetDir, corpusDir, profile: "evolving", yes: true, tools: PAIR });

    const parsed = parseYaml(readFileSync(join(targetDir, "eep.yaml"), "utf8"));
    expect(parsed).toEqual({ profile: "evolving", packs: ["python-fastapi"], tools: PAIR });
  });

  // With no --tools and no prior selection, a fresh repository resolves to the AGENTS.md baseline: one
  // universal instruction file rather than a spread of tool specific ones nobody asked for.
  it("defaults a fresh repository to the AGENTS.md baseline", async () => {
    const targetDir = newTargetDir("eep-adopt-default-tools-");
    writeFastApiPyproject(targetDir);

    const result = await runAdopt({ targetDir, corpusDir, profile: "evolving", yes: true });

    expect(result.tools).toEqual(["agents"]);
    expect(existsSync(join(targetDir, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(targetDir, "CLAUDE.md"))).toBe(false);
    expect(existsSync(join(targetDir, ".github", "copilot-instructions.md"))).toBe(false);
    expect(existsSync(join(targetDir, ".cursor", "rules", "eep.mdc"))).toBe(false);
    const parsed = parseYaml(readFileSync(join(targetDir, "eep.yaml"), "utf8"));
    expect(parsed.tools).toEqual(["agents"]);
  });

  // Auto detection: a repository that already carries a CLAUDE.md and a .cursor directory is a
  // repository whose team uses those tools, so adopt generates for them without being told.
  it("detects the tool selection from files the repository already carries", async () => {
    const targetDir = newTargetDir("eep-adopt-detect-tools-");
    writeFastApiPyproject(targetDir);
    writeFileSync(join(targetDir, "CLAUDE.md"), "# House rules\n\nOurs.\n");
    mkdirSync(join(targetDir, ".cursor", "rules"), { recursive: true });
    writeFileSync(join(targetDir, ".cursor", "rules", "team.mdc"), "# Team rule\n");

    const result = await runAdopt({ targetDir, corpusDir, profile: "evolving", yes: true });

    expect(result.tools).toEqual(["claude", "cursor"]);
    expect(existsSync(join(targetDir, ".cursor", "rules", "eep.mdc"))).toBe(true);
    expect(existsSync(join(targetDir, "AGENTS.md"))).toBe(false);
    // The team's own cursor rule is never touched.
    expect(readFileSync(join(targetDir, ".cursor", "rules", "team.mdc"), "utf8")).toBe(
      "# Team rule\n",
    );
  });

  // An explicit --tools token that names no tool is refused before anything is written, the same way
  // an unknown framework token is.
  it("rejects an unknown tool token", async () => {
    const targetDir = newTargetDir("eep-adopt-badtool-");
    writeFastApiPyproject(targetDir);

    await expect(
      runAdopt({ targetDir, corpusDir, profile: "evolving", yes: true, tools: ["cobol"] }),
    ).rejects.toThrow(/unknown tool: cobol/);
  });

  // The none selection writes no agent instruction files, but the gate and the vendored tree still
  // land, so the repository is governed without any tool specific prose.
  it("writes no agent instruction files for a none selection", async () => {
    const targetDir = newTargetDir("eep-adopt-none-tools-");
    writeFastApiPyproject(targetDir);

    const result = await runAdopt({
      targetDir,
      corpusDir,
      profile: "evolving",
      yes: true,
      tools: ["none"],
    });

    expect(result.tools).toEqual([]);
    for (const relPath of ["AGENTS.md", "CLAUDE.md", ".github/copilot-instructions.md"]) {
      expect(existsSync(join(targetDir, relPath)), relPath).toBe(false);
    }
    expect(existsSync(join(targetDir, ".cursor", "rules", "eep.mdc"))).toBe(false);
    expect(existsSync(join(targetDir, ".eep", "lock.yaml"))).toBe(true);
    expect(parseYaml(readFileSync(join(targetDir, "eep.yaml"), "utf8")).tools).toEqual([]);
  });

  it("refuses to run without --yes outside a TTY", async () => {
    const targetDir = newTargetDir("eep-adopt-noninteractive-");
    await gitInit(targetDir);
    writeFastApiPyproject(targetDir);

    await expect(
      runAdopt({ targetDir, corpusDir, profile: "evolving", yes: false }),
    ).rejects.toThrow("eep: refusing to adopt without --yes in non interactive mode");
  });

  /**
   * The brownfield end to end: a repository with its own CLAUDE.md, its own AGENTS.md, and its own
   * pre-commit hook comes out of adopt with all three intact.
   */
  it("preserves a repository's own agent files and pre-commit hook", async () => {
    const targetDir = newTargetDir("eep-adopt-brownfield-");
    await gitInit(targetDir);
    writeFastApiPyproject(targetDir);

    const ownClaude = "# House rules\n\nSkip tests for prototypes.\n";
    const ownAgents = "# Agent notes\n\nAsk before touching payments.\n";
    const ownHook = '#!/bin/sh\necho "our own hook"\nexit 0\n';
    writeFileSync(join(targetDir, "CLAUDE.md"), ownClaude);
    writeFileSync(join(targetDir, "AGENTS.md"), ownAgents);
    mkdirSync(join(targetDir, ".git", "hooks"), { recursive: true });
    writeFileSync(join(targetDir, ".git", "hooks", "pre-commit"), ownHook);

    const logs = await captureLogs(() =>
      runAdopt({ targetDir, corpusDir, profile: "evolving", yes: true }).then(() => undefined),
    );

    const claude = readFileSync(join(targetDir, "CLAUDE.md"), "utf8");
    const agents = readFileSync(join(targetDir, "AGENTS.md"), "utf8");
    expect(claude.startsWith(ownClaude)).toBe(true);
    expect(agents.startsWith(ownAgents)).toBe(true);
    expect(claude).toContain(BLOCK_BEGIN);
    expect(claude.endsWith(`${BLOCK_END}\n`)).toBe(true);

    expect(readFileSync(join(targetDir, ".git", "hooks", "pre-commit"), "utf8")).toBe(ownHook);
    const chained = join(targetDir, ".git", "hooks", "pre-commit-eep");
    expect(existsSync(chained)).toBe(true);
    expect(readFileSync(chained, "utf8")).toContain("eep verify --changed");
    expect(logs).toContain(
      'eep: existing pre-commit hook preserved; add this line to it to chain the gate: .git/hooks/pre-commit-eep "$@" || exit 1',
    );
  });

  /**
   * The same repository one adoption later, after somebody pasted the gate script into their own
   * hook rather than calling it. Their lint and test commands have to survive a re adopt.
   */
  it("keeps a foreign hook that carries our pasted script across a re adopt", async () => {
    const targetDir = newTargetDir("eep-adopt-pasted-hook-");
    await gitInit(targetDir);
    writeFastApiPyproject(targetDir);

    const ownHook = [
      "#!/bin/sh",
      "set -e",
      "ruff check .",
      "pytest -q",
      "",
      "# Installed by eep adopt. The gate runs before the commit exists.",
      "if command -v eep >/dev/null 2>&1; then",
      "  eep verify --changed || exit 1",
      "fi",
      "",
    ].join("\n");
    mkdirSync(join(targetDir, ".git", "hooks"), { recursive: true });
    writeFileSync(join(targetDir, ".git", "hooks", "pre-commit"), ownHook);

    await captureLogs(() =>
      runAdopt({ targetDir, corpusDir, profile: "evolving", yes: true }).then(() => undefined),
    );
    await captureLogs(() =>
      runAdopt({ targetDir, corpusDir, profile: "evolving", yes: true }).then(() => undefined),
    );

    expect(readFileSync(join(targetDir, ".git", "hooks", "pre-commit"), "utf8")).toBe(ownHook);
  });
});

/**
 * A pre-commit hook is frequently the only automation a team has, and it is not a file this program
 * gets to replace on the way past. Ours is recognized by the marker it writes into itself; anything
 * without that marker belongs to somebody else.
 */
describe("installGitHook", () => {
  function newGitDir(prefix: string): string {
    const dir = newTargetDir(prefix);
    mkdirSync(join(dir, ".git", "hooks"), { recursive: true });
    return dir;
  }

  it("writes the gate when there is no hook at all", async () => {
    const dir = newGitDir("eep-hook-absent-");

    await captureLogs(() => installGitHook(dir));

    const hookPath = join(dir, ".git", "hooks", "pre-commit");
    expect(readFileSync(hookPath, "utf8")).toContain("Installed by eep adopt");
    expect(statSync(hookPath).mode & 0o111).not.toBe(0);
    expect(existsSync(join(dir, ".git", "hooks", "pre-commit-eep"))).toBe(false);
  });

  it("leaves a foreign hook untouched, writes the gate beside it, and prints the chain line", async () => {
    const dir = newGitDir("eep-hook-foreign-");
    const foreign = '#!/bin/sh\necho "lint and secrets"\nexit 0\n';
    writeFileSync(join(dir, ".git", "hooks", "pre-commit"), foreign);

    const logs = await captureLogs(() => installGitHook(dir));

    expect(readFileSync(join(dir, ".git", "hooks", "pre-commit"), "utf8")).toBe(foreign);
    const chained = join(dir, ".git", "hooks", "pre-commit-eep");
    expect(readFileSync(chained, "utf8")).toContain("Installed by eep adopt");
    expect(statSync(chained).mode & 0o111).not.toBe(0);
    expect(logs).toContain(
      'eep: existing pre-commit hook preserved; add this line to it to chain the gate: .git/hooks/pre-commit-eep "$@" || exit 1',
    );
  });

  it("overwrites a hook it wrote itself", async () => {
    const dir = newGitDir("eep-hook-ours-");
    const stale = "#!/bin/sh\n# Installed by eep adopt. An older release wrote this.\nexit 0\n";
    writeFileSync(join(dir, ".git", "hooks", "pre-commit"), stale);

    const logs = await captureLogs(() => installGitHook(dir));

    const content = readFileSync(join(dir, ".git", "hooks", "pre-commit"), "utf8");
    expect(content).toContain("eep verify --changed");
    expect(content).not.toContain("An older release wrote this");
    expect(existsSync(join(dir, ".git", "hooks", "pre-commit-eep"))).toBe(false);
    expect(logs.join("\n")).not.toContain("preserved");
  });

  /**
   * The exact shape a repository reaches by following the chain instruction the wrong way: instead
   * of calling `.git/hooks/pre-commit-eep`, they pasted its contents, marker comment and all, into
   * the bottom of their own hook. Ownership matched on the marker anywhere in the file would then
   * read that hook as ours and overwrite their ruff and pytest lines. Ownership is the marker on
   * line 2, which this hook does not have.
   */
  it("treats a foreign hook that has our script pasted into it as foreign", async () => {
    const dir = newGitDir("eep-hook-pasted-");
    const foreign = [
      "#!/bin/sh",
      "set -e",
      "ruff check .",
      "pytest -q",
      "",
      "# Installed by eep adopt. The gate runs before the commit exists.",
      "if command -v eep >/dev/null 2>&1; then",
      "  eep verify --changed || exit 1",
      "fi",
      "",
    ].join("\n");
    const hookPath = join(dir, ".git", "hooks", "pre-commit");
    writeFileSync(hookPath, foreign);

    const logs = await captureLogs(() => installGitHook(dir));
    // Re adopting must be as safe as adopting: run it twice.
    await captureLogs(() => installGitHook(dir));

    expect(readFileSync(hookPath, "utf8")).toBe(foreign);
    expect(readFileSync(hookPath, "utf8")).toContain("ruff check .");
    expect(readFileSync(hookPath, "utf8")).toContain("pytest -q");
    expect(existsSync(join(dir, ".git", "hooks", "pre-commit-eep"))).toBe(true);
    expect(logs.join("\n")).toContain("existing pre-commit hook preserved");
  });

  /**
   * A repository that sets core.hooksPath has told git to run hooks from somewhere else entirely,
   * which is what husky and lefthook do. Writing .git/hooks/pre-commit under that setting installs a
   * file git will never execute: the gate would be reported as installed and would never run.
   */
  it("writes no .git/hooks/pre-commit when core.hooksPath is set", async () => {
    const dir = newTargetDir("eep-hook-hookspath-");
    await gitInit(dir);
    await execa("git", ["config", "core.hooksPath", ".husky"], { cwd: dir });

    const logs = await captureLogs(() => installGitHook(dir));

    expect(existsSync(join(dir, ".git", "hooks", "pre-commit"))).toBe(false);
    const chained = join(dir, ".git", "hooks", "pre-commit-eep");
    expect(readFileSync(chained, "utf8")).toContain("eep verify --changed");
    expect(statSync(chained).mode & 0o111).not.toBe(0);
    expect(logs).toContain(
      'eep: core.hooksPath is set (.husky); add this line to your hook manager\'s pre-commit: .git/hooks/pre-commit-eep "$@" || exit 1',
    );
  });
});

/**
 * The plan is the last thing a reader sees before consenting to the write, so every line naming a
 * file this program does not own has to say what will actually happen to it rather than the pre
 * managed block "will write". That is the two agent files and the pre-commit hook.
 */
describe("plannedFiles wording for the files eep does not own", () => {
  const PACKS = ["python-fastapi"];

  function planFor(seed: (dir: string) => void, tools: ToolToken[] = PAIR): string[] {
    const dir = newTargetDir("eep-plan-");
    writeFastApiPyproject(dir);
    seed(dir);
    return plannedFiles(dir, corpusDir, PACKS, tools);
  }

  function writeHook(dir: string, content: string): void {
    mkdirSync(join(dir, ".git", "hooks"), { recursive: true });
    writeFileSync(join(dir, ".git", "hooks", "pre-commit"), content);
  }

  it("says create when neither agent file exists", () => {
    const plan = planFor(() => {});

    expect(plan).toContain("create CLAUDE.md (managed block)");
    expect(plan).toContain("create AGENTS.md (managed block)");
    expect(plan).toContain(".eep/");
    expect(plan).toContain("eep.yaml");
  });

  it("says appended, and names the preservation, when the file is the repository's own", () => {
    const plan = planFor((dir) => {
      writeFileSync(join(dir, "CLAUDE.md"), "# House rules\n\nOurs.\n");
    });

    expect(plan).toContain("update CLAUDE.md (managed block appended; your content preserved)");
    expect(plan).toContain("create AGENTS.md (managed block)");
  });

  it("says refreshed when the file already carries a block", () => {
    const plan = planFor((dir) => {
      writeFileSync(
        join(dir, "CLAUDE.md"),
        `# Ours\n\n${BLOCK_BEGIN}\n${AUTHORITY_SENTENCE}\n\nold\n${BLOCK_END}\n`,
      );
    });

    expect(plan).toContain("update CLAUDE.md (managed block refreshed)");
  });

  it("says skip when the markers are malformed, because that is what the write will do", () => {
    const plan = planFor((dir) => {
      writeFileSync(
        join(dir, "CLAUDE.md"),
        `# Ours\n\n${BLOCK_BEGIN}\n${AUTHORITY_SENTENCE}\n\nno end marker\n`,
      );
    });

    expect(plan).toContain("skip CLAUDE.md (malformed managed block; left untouched)");
  });

  // A directory with no .git at all takes this branch too: there is no hook file at that path, so a
  // create is what the run attempts, and installGitHook warns for itself when it cannot.
  it("says create for the hook when there is none", () => {
    expect(planFor(() => {})).toContain("create .git/hooks/pre-commit");
    expect(planFor((dir) => mkdirSync(join(dir, ".git", "hooks"), { recursive: true }))).toContain(
      "create .git/hooks/pre-commit",
    );
  });

  it("says update for a hook this program wrote", () => {
    const plan = planFor((dir) => {
      writeHook(dir, "#!/bin/sh\n# Installed by eep adopt.\nexit 0\n");
    });

    expect(plan).toContain("update .git/hooks/pre-commit (eep managed)");
  });

  /**
   * The line a brownfield reader most needs before consenting: their hook stays, and the gate lands
   * beside it under a name they would otherwise never think to look for.
   */
  it("says preserve, and names the sibling it creates, for a hook that is not ours", () => {
    const plan = planFor((dir) => {
      writeHook(dir, '#!/bin/sh\necho "lint and secrets"\nexit 0\n');
    });

    expect(plan).toContain(
      "preserve .git/hooks/pre-commit (yours); create .git/hooks/pre-commit-eep",
    );
    expect(plan).not.toContain("create .git/hooks/pre-commit");
  });

  // Our own script pasted into somebody's hook is still somebody's hook, and the plan has to say so
  // before consent, not only the installer afterwards.
  it("says preserve for a foreign hook carrying our marker below line 2", () => {
    const plan = planFor((dir) => {
      writeHook(
        dir,
        "#!/bin/sh\nruff check .\n\n# Installed by eep adopt. The gate runs before the commit exists.\neep verify --changed || exit 1\n",
      );
    });

    expect(plan).toContain(
      "preserve .git/hooks/pre-commit (yours); create .git/hooks/pre-commit-eep",
    );
  });

  it("names the hook manager when core.hooksPath is set", async () => {
    const dir = newTargetDir("eep-plan-hookspath-");
    writeFastApiPyproject(dir);
    await gitInit(dir);
    await execa("git", ["config", "core.hooksPath", ".husky"], { cwd: dir });

    expect(plannedFiles(dir, corpusDir, PACKS, PAIR)).toContain(
      "preserve hook manager (.husky); create .git/hooks/pre-commit-eep",
    );
  });

  // Only the selected surfaces appear, each with the wording its kind gets: the co owned files as a
  // managed block line, the Cursor rule as a plain write since eep overwrites it whole.
  it("lists only the surfaces the tool selection names", () => {
    const plan = planFor(() => {}, ["copilot", "cursor"]);

    expect(plan).toContain("create .github/copilot-instructions.md (managed block)");
    expect(plan).toContain("write .cursor/rules/eep.mdc");
    expect(plan.some((line) => line.includes("CLAUDE.md"))).toBe(false);
    expect(plan.some((line) => line.includes("AGENTS.md"))).toBe(false);
  });

  // The none selection has to say plainly that no agent files are written, so a reader consenting to
  // the plan is not left wondering where their instructions went.
  it("documents that a none selection writes no agent instruction files", () => {
    const plan = planFor(() => {}, []);

    expect(plan).toContain("no agent instruction files (tools: none)");
    expect(plan.some((line) => line.includes("CLAUDE.md"))).toBe(false);
    expect(plan).toContain(".eep/");
    expect(plan).toContain("eep.yaml");
  });
});
