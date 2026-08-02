import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import { installGitHook, plannedFiles, runAdopt } from "../src/commands/adopt.js";
import { BLOCK_BEGIN, BLOCK_END } from "../src/lib/managed-block.js";
import { repoRoot } from "../src/lib/schema.js";

const corpusDir = repoRoot();

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

    const result = await runAdopt({ targetDir, corpusDir, profile: "evolving", yes: true });

    expect(result.packs).toEqual(["python-fastapi"]);
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

    const result = await runAdopt({ targetDir, corpusDir, profile: "evolving", yes: true });

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

    const result = await runAdopt({ targetDir, corpusDir, profile: "evolving", yes: true });

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

  it("writes eep.yaml that parses to the profile and detected packs", async () => {
    const targetDir = newTargetDir("eep-adopt-yaml-");
    writeFastApiPyproject(targetDir);

    await runAdopt({ targetDir, corpusDir, profile: "evolving", yes: true });

    const parsed = parseYaml(readFileSync(join(targetDir, "eep.yaml"), "utf8"));
    expect(parsed).toEqual({ profile: "evolving", packs: ["python-fastapi"] });
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
});

/**
 * The plan is the last thing a reader sees before consenting to the write, so every line naming a
 * file this program does not own has to say what will actually happen to it rather than the pre
 * managed block "will write". That is the two agent files and the pre-commit hook.
 */
describe("plannedFiles wording for the files eep does not own", () => {
  const PACKS = ["python-fastapi"];

  function planFor(seed: (dir: string) => void): string[] {
    const dir = newTargetDir("eep-plan-");
    writeFastApiPyproject(dir);
    seed(dir);
    return plannedFiles(dir, corpusDir, PACKS);
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
      writeFileSync(join(dir, "CLAUDE.md"), `# Ours\n\n${BLOCK_BEGIN}\nold\n${BLOCK_END}\n`);
    });

    expect(plan).toContain("update CLAUDE.md (managed block refreshed)");
  });

  it("says skip when the markers are malformed, because that is what the write will do", () => {
    const plan = planFor((dir) => {
      writeFileSync(join(dir, "CLAUDE.md"), `# Ours\n\n${BLOCK_BEGIN}\nno end marker\n`);
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
});
