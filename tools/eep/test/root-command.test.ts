import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { execa } from "execa";
import { describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import { capabilityScreenLines, runSync } from "../src/commands/root.js";
import { TIP_LINE } from "../src/lib/install-offer.js";
import { repoRoot } from "../src/lib/schema.js";
import { childPath } from "./helpers.js";

const corpusDir = repoRoot();

function newTargetDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

// The same PATH with a stand in for npm's global shim prepended. Never executed: the resolver only
// reads its name, type, and mode.
function pathWithFakeEep(): string {
  const dir = newTargetDir("eep-fake-bin-");
  const file = join(dir, "eep");
  writeFileSync(file, "#!/bin/sh\nexit 0\n");
  chmodSync(file, 0o755);
  return [dir, childPath()].join(delimiter);
}

async function withPath<T>(value: string, fn: () => T | Promise<T>): Promise<T> {
  const original = process.env.PATH;
  process.env.PATH = value;
  try {
    return await fn();
  } finally {
    if (original === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = original;
    }
  }
}

async function captureLog(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(" "));
  });
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return lines.join("\n");
}

// The one sanctioned git use in this suite: initializing a throwaway fixture directory under the
// OS temp dir so the sync has a real .git to install its hook into. This never touches the corpus
// repository itself.
async function gitInit(dir: string): Promise<void> {
  await execa("git", ["init"], { cwd: dir });
}

function writeFastApiPyproject(dir: string): void {
  writeFileSync(join(dir, "pyproject.toml"), '[project]\ndependencies = ["fastapi"]\n');
}

function readLock(dir: string): Record<string, unknown> {
  return parseYaml(readFileSync(join(dir, ".eep", "lock.yaml"), "utf8"));
}

function expectNothingWritten(dir: string): void {
  expect(existsSync(join(dir, ".eep"))).toBe(false);
  expect(existsSync(join(dir, "eep.yaml"))).toBe(false);
  expect(existsSync(join(dir, "CLAUDE.md"))).toBe(false);
  expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
}

describe("runSync", () => {
  it("syncs a git repo to the named framework: vendors, generates, and installs the hook", async () => {
    const targetDir = newTargetDir("eep-sync-git-");
    await gitInit(targetDir);
    writeFastApiPyproject(targetDir);

    const result = await runSync({ targetDir, corpusDir, tokens: ["fastapi"], yes: true });

    expect(result.packs).toEqual(["python-fastapi"]);
    expect(result.profile).toBe("evolving");
    expect(existsSync(join(targetDir, ".eep", "lock.yaml"))).toBe(true);
    expect(existsSync(join(targetDir, "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(targetDir, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(targetDir, "eep.yaml"))).toBe(true);

    const hookPath = join(targetDir, ".git", "hooks", "pre-commit");
    expect(existsSync(hookPath)).toBe(true);
    expect(statSync(hookPath).mode & 0o111).not.toBe(0);
    const hookContent = readFileSync(hookPath, "utf8");
    expect(hookContent).toContain("eep verify --changed");
    expect(hookContent).toContain("npx -y engineering-excellence");

    const parsed = parseYaml(readFileSync(join(targetDir, "eep.yaml"), "utf8"));
    expect(parsed).toEqual({ profile: "evolving", packs: ["python-fastapi"] });
  });

  // Explicit selection is a declaration of intent, not a claim about what is already on disk: a
  // user may add a pack before any code that would match its detect rules exists.
  it("syncs a directory whose contents do not match the requested pack yet", async () => {
    const targetDir = newTargetDir("eep-sync-nodetect-");

    const result = await runSync({ targetDir, corpusDir, tokens: ["fastapi"], yes: true });

    expect(result.packs).toEqual(["python-fastapi"]);
    expect(existsSync(join(targetDir, ".eep", "lock.yaml"))).toBe(true);
    expect(existsSync(join(targetDir, "CLAUDE.md"))).toBe(true);
  });

  // The roadmap tokens named here (angular, go) are ones no wave of the current roadmap builds.
  // The subject is the skip and refuse behavior, not which packs happen to exist this week, and a
  // token whose pack is about to land would turn these red the day it does.
  it("skips frameworks that are not built yet and continues with the rest", async () => {
    const targetDir = newTargetDir("eep-sync-partial-");

    const result = await runSync({
      targetDir,
      corpusDir,
      tokens: ["fastapi", "go", "angular"],
      yes: true,
    });

    expect(result.packs).toEqual(["python-fastapi"]);
    expect(result.comingSoon).toEqual(["go", "angular"]);
    expect(existsSync(join(targetDir, ".eep", "lock.yaml"))).toBe(true);
  });

  it("rejects an unknown token and writes nothing", async () => {
    const targetDir = newTargetDir("eep-sync-unknown-");

    await expect(
      runSync({ targetDir, corpusDir, tokens: ["fastapi", "cobol"], yes: true }),
    ).rejects.toThrow(/unknown framework/);
    expectNothingWritten(targetDir);
  });

  it("rejects when every requested framework is still in development", async () => {
    const targetDir = newTargetDir("eep-sync-unbuilt-");

    await expect(
      runSync({ targetDir, corpusDir, tokens: ["go", "angular"], yes: true }),
    ).rejects.toThrow(/nothing to sync/);
    expectNothingWritten(targetDir);
  });

  it("refuses to sync without --yes outside a TTY", async () => {
    const targetDir = newTargetDir("eep-sync-noninteractive-");

    await expect(
      runSync({ targetDir, corpusDir, tokens: ["fastapi"], yes: false }),
    ).rejects.toThrow("eep: refusing to sync without --yes in non interactive mode");
    expectNothingWritten(targetDir);
  });

  it("produces the same result when the same list is synced twice", async () => {
    const targetDir = newTargetDir("eep-sync-idempotent-");
    writeFastApiPyproject(targetDir);

    await runSync({ targetDir, corpusDir, tokens: ["fastapi"], yes: true });
    const firstLock = readLock(targetDir);
    const firstAgents = readFileSync(join(targetDir, "AGENTS.md"), "utf8");
    const firstEepYaml = readFileSync(join(targetDir, "eep.yaml"), "utf8");

    await runSync({ targetDir, corpusDir, tokens: ["fastapi"], yes: true });

    expect(readLock(targetDir)).toEqual(firstLock);
    expect(readFileSync(join(targetDir, "AGENTS.md"), "utf8")).toBe(firstAgents);
    expect(readFileSync(join(targetDir, "eep.yaml"), "utf8")).toBe(firstEepYaml);
  });

  it("reuses the profile recorded in an existing lock file when none is requested", async () => {
    const targetDir = newTargetDir("eep-sync-profile-reuse-");

    await runSync({
      targetDir,
      corpusDir,
      tokens: ["fastapi"],
      profile: "greenfield",
      yes: true,
    });
    expect(readLock(targetDir).profile).toBe("greenfield");

    const result = await runSync({ targetDir, corpusDir, tokens: ["fastapi"], yes: true });

    expect(result.profile).toBe("greenfield");
    expect(readLock(targetDir).profile).toBe("greenfield");
    expect(parseYaml(readFileSync(join(targetDir, "eep.yaml"), "utf8")).profile).toBe("greenfield");
  });

  it("lets an explicit profile override the one recorded in the lock file", async () => {
    const targetDir = newTargetDir("eep-sync-profile-override-");

    await runSync({ targetDir, corpusDir, tokens: ["fastapi"], profile: "greenfield", yes: true });
    const result = await runSync({
      targetDir,
      corpusDir,
      tokens: ["fastapi"],
      profile: "evolving",
      yes: true,
    });

    expect(result.profile).toBe("evolving");
    expect(readLock(targetDir).profile).toBe("evolving");
  });

  it("preserves the consumer's waivers across a sync", async () => {
    const targetDir = newTargetDir("eep-sync-waivers-");
    await runSync({ targetDir, corpusDir, tokens: ["fastapi"], yes: true });
    const waiversPath = join(targetDir, ".eep", "waivers.yaml");
    writeFileSync(waiversPath, "waivers: []\n");

    await runSync({ targetDir, corpusDir, tokens: ["fastapi"], yes: true });

    expect(readFileSync(waiversPath, "utf8")).toBe("waivers: []\n");
  });
});

describe("capabilityScreenLines", () => {
  it("names what eep is, what ships today, and what is on the roadmap", async () => {
    const targetDir = newTargetDir("eep-capabilities-bare-");
    const screen = await withPath(childPath(), () =>
      capabilityScreenLines(corpusDir, targetDir).join("\n"),
    );

    expect(screen).toContain("Available now:");
    expect(screen).toContain("fastapi (python-fastapi)");
    expect(screen).toContain("In development:");
    expect(screen).toContain("node");
    expect(screen).toContain("npx engineering-excellence fastapi");
    expect(screen).toContain("npx engineering-excellence fastapi node angular");
    expect(screen).not.toContain("Detected in this project");
  });

  it("names the detected framework and the command that adopts it", async () => {
    const targetDir = newTargetDir("eep-capabilities-detected-");
    writeFastApiPyproject(targetDir);

    const screen = await withPath(childPath(), () =>
      capabilityScreenLines(corpusDir, targetDir).join("\n"),
    );

    expect(screen).toContain(
      "Detected in this project: fastapi. Run: npx engineering-excellence fastapi",
    );
  });

  // A global install user typed a bare `eep` to reach this screen, so every command on it is
  // printed in the form they just used.
  it("prints the bare command form when eep resolves on PATH", async () => {
    const targetDir = newTargetDir("eep-capabilities-onpath-");
    writeFastApiPyproject(targetDir);

    const screen = await withPath(pathWithFakeEep(), () =>
      capabilityScreenLines(corpusDir, targetDir).join("\n"),
    );

    expect(screen).toContain("  eep fastapi");
    expect(screen).toContain("Detected in this project: fastapi. Run: eep fastapi");
    expect(screen).not.toContain("npx engineering-excellence");
  });
});

/**
 * The bug this covers: a consumer who reached the CLI through npx was told to run `eep verify`,
 * a command their shell does not have. Guidance now names whichever form actually works, and the
 * run ends by offering the global install that would make the short form true.
 */
describe("invocation aware guidance and the global install offer", () => {
  it("prints the npx form and one install hint when eep is not on PATH", async () => {
    const targetDir = newTargetDir("eep-sync-guidance-npx-");

    const output = await withPath(childPath(), () =>
      captureLog(async () => {
        await runSync({ targetDir, corpusDir, tokens: ["fastapi"], yes: true });
      }),
    );

    expect(output).toContain("npx engineering-excellence verify");
    expect(output).toContain("npx engineering-excellence explain <LAW-ID>");
    expect(output).not.toContain("eep verify");
    expect(output).toContain(TIP_LINE);
  });

  it("prints the bare form and no hint when eep is on PATH", async () => {
    const targetDir = newTargetDir("eep-sync-guidance-bare-");

    const output = await withPath(pathWithFakeEep(), () =>
      captureLog(async () => {
        await runSync({ targetDir, corpusDir, tokens: ["fastapi"], yes: true });
      }),
    );

    expect(output).toContain("2. eep verify 3. eep explain <LAW-ID>");
    expect(output).not.toContain("npx engineering-excellence");
    expect(output).not.toContain(TIP_LINE);
    expect(output).not.toContain("tip:");
  });

  // What CI and scripted runs pass: the guidance still adapts, but nothing offers to change the
  // machine and no hint clutters the transcript.
  it("suppresses the hint entirely when the install offer is turned off", async () => {
    const targetDir = newTargetDir("eep-sync-guidance-nooffer-");

    const output = await withPath(childPath(), () =>
      captureLog(async () => {
        await runSync({
          targetDir,
          corpusDir,
          tokens: ["fastapi"],
          yes: true,
          installOffer: false,
        });
      }),
    );

    expect(output).toContain("npx engineering-excellence verify");
    expect(output).not.toContain(TIP_LINE);
    expect(output).not.toContain("tip:");
  });
});
