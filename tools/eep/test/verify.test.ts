import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execa } from "execa";
import fg from "fast-glob";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stringify as stringifyYaml } from "yaml";
import { runAdopt } from "../src/commands/adopt.js";
import { runVerify, type VerifyResult } from "../src/commands/verify.js";
import { repoRoot } from "../src/lib/schema.js";

const root = repoRoot();
const SCAFFOLD = join(root, "packs", "stack", "python-fastapi", "scaffold");
const PROJECT_NAME = "verifyfixture";

// Assembled from fragments so this test file never itself carries a literal credential shaped
// string that the corpus's own secrets-scan would flag.
const AWS_KEY_LINE = `AWS_KEY = "AKIA${"ABCDEFGHIJKLMNOP"}"\n`;

// Escape, not the literal glyph, so this source stays free of the banned character it plants.
const EM_DASH = "\u2014";

const SECRET_TARGET = join("app", "core", "config.py");

const BUILD_TIMEOUT = 900_000;
const VERIFY_TIMEOUT = 300_000;

async function uvAvailable(): Promise<boolean> {
  try {
    const result = await execa("which", ["uv"], { reject: false });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

const hasUv = await uvAvailable();

function substituteProjectName(dir: string): void {
  for (const relPath of fg.sync("**/*", { cwd: dir, dot: true, onlyFiles: true })) {
    const absPath = join(dir, relPath);
    const text = readFileSync(absPath, "utf8");
    if (!text.includes("{{project_name}}")) continue;
    writeFileSync(absPath, text.replaceAll("{{project_name}}", PROJECT_NAME));
  }
}

// Sanctioned by the task dispatch: git runs only inside this throwaway fixture, never against the
// corpus checkout. Identity is passed per invocation so the fixture does not depend on, or
// disturb, whatever global git config the machine happens to carry.
async function gitInitAndCommit(dir: string): Promise<void> {
  await execa("git", ["init", "--quiet"], { cwd: dir });
  await execa("git", ["add", "-A"], { cwd: dir });
  await execa(
    "git",
    [
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "user.name=EEP Fixture",
      "commit",
      "--quiet",
      "-m",
      "scaffold",
    ],
    { cwd: dir },
  );
}

function write(dir: string, relPath: string, contents: string): void {
  const absPath = join(dir, relPath);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, contents);
}

function find(results: VerifyResult[], law: string): VerifyResult | undefined {
  return results.find((result) => result.law === law);
}

// Failure output for assertion messages: shows exactly which laws failed and why, so a red
// integration run reads as a diagnosis rather than "expected 0, got 3".
function describeFailures(results: VerifyResult[]): string {
  const failures = results.filter((result) => result.status === "fail");
  if (failures.length === 0) return "no failures";
  return failures.map((result) => `${result.law} [${result.severity}] ${result.detail}`).join("\n");
}

function waiverYaml(expires: string): string {
  return [
    "- law: EEP-DOCS-02",
    "  scope: docs/**",
    '  justification: "The imported vendor note is rewritten next sprint."',
    "  owner: '@fixture-owner'",
    "  created: 2026-08-01",
    `  expires: ${expires}`,
    "",
  ].join("\n");
}

describe.skipIf(!hasUv)("runVerify against an adopted consumer repository", () => {
  let fixture: string;

  beforeAll(async () => {
    fixture = mkdtempSync(join(tmpdir(), "eep-verify-"));
    cpSync(SCAFFOLD, fixture, { recursive: true });
    substituteProjectName(fixture);
    await gitInitAndCommit(fixture);
    await execa("uv", ["sync", "--quiet"], { cwd: fixture });
    await runAdopt({ targetDir: fixture, corpusDir: root, profile: "greenfield", yes: true });
  }, BUILD_TIMEOUT);

  afterAll(() => {
    if (fixture !== undefined) rmSync(fixture, { recursive: true, force: true });
  });

  it(
    "passes every blocking law on a freshly adopted scaffold",
    async () => {
      const report = await runVerify(fixture);

      expect(report.failedBlocking, describeFailures(report.results)).toBe(0);
      expect(find(report.results, "EEP-DOCS-03")?.status).toBe("skipped");
      expect(find(report.results, "EEP-DOCS-01")?.detail).toContain("skipped: no docs directory");
    },
    VERIFY_TIMEOUT,
  );

  it(
    "fails EEP-SEC-01 naming the file once a credential lands in a tracked source file",
    async () => {
      const absPath = join(fixture, SECRET_TARGET);
      const original = readFileSync(absPath, "utf8");
      writeFileSync(absPath, `${original}\n${AWS_KEY_LINE}`);

      try {
        const report = await runVerify(fixture);
        const secrets = find(report.results, "EEP-SEC-01");

        expect(secrets?.status).toBe("fail");
        expect(secrets?.detail).toContain("app/core/config.py");
        expect(secrets?.detail).toContain("aws-access-key-id");
        expect(report.failedBlocking).toBeGreaterThan(0);
      } finally {
        writeFileSync(absPath, original);
      }
    },
    VERIFY_TIMEOUT,
  );

  it(
    "waives a failing law while the waiver holds, and fails the waiver itself once it expires",
    async () => {
      write(
        fixture,
        join("docs", "note.md"),
        `---\ntitle: A note\nauthors: [{ name: Fixture }]\n---\n\nOne thing ${EM_DASH} then another.\n`,
      );
      const waiversPath = join(".eep", "waivers.yaml");

      try {
        write(fixture, waiversPath, waiverYaml("2026-11-01"));
        const waived = await runVerify(fixture);
        const waivedDocs = find(waived.results, "EEP-DOCS-02");

        expect(waivedDocs?.status).toBe("waived");
        expect(waivedDocs?.detail).toContain("rewritten next sprint");
        expect(waivedDocs?.detail).toContain("@fixture-owner");
        expect(waivedDocs?.detail).toContain("original: style issues");
        expect(waivedDocs?.detail).toContain("docs/note.md:6 banned-dash");
        expect(find(waived.results, "EEP-GOV-WAIVER")).toBeUndefined();

        write(fixture, waiversPath, waiverYaml("2026-07-01"));
        const expired = await runVerify(fixture);

        expect(find(expired.results, "EEP-DOCS-02")?.status).toBe("fail");
        const waiverFail = find(expired.results, "EEP-GOV-WAIVER");
        expect(waiverFail?.status).toBe("fail");
        expect(waiverFail?.severity).toBe("blocking");
        expect(waiverFail?.detail).toContain("expired");
        expect(expired.failedBlocking).toBeGreaterThanOrEqual(2);
      } finally {
        rmSync(join(fixture, "docs"), { recursive: true, force: true });
        rmSync(join(fixture, waiversPath), { force: true });
      }
    },
    VERIFY_TIMEOUT,
  );
});

// A hand built .eep tree whose checks are all builtins. No uv, no python, no network: these
// exercise runVerify's own logic (severity mapping, changed narrowing, waiver arbitration, the
// fail closed guards) everywhere the suite runs, not only on a machine carrying the toolchain.
type FixtureLaw = {
  id: string;
  severity: "blocking" | "warning" | "advisory";
  command: string;
  waivable?: boolean;
};

const PACK_NAME = "fixture-pack";

function writeYaml(dir: string, relPath: string, value: unknown): void {
  write(dir, relPath, stringifyYaml(value));
}

function buildEepTree(dir: string, laws: FixtureLaw[], packs?: unknown): void {
  writeYaml(dir, join(".eep", "profiles", "greenfield.yaml"), {
    name: "greenfield",
    enforcement: "all",
    description: "Fixture profile.",
  });
  writeYaml(dir, join(".eep", "lock.yaml"), {
    program_version: "0.1.0",
    profile: "greenfield",
    packs: packs ?? [{ name: PACK_NAME, version: "1.0.0" }],
    vendored: "2026-08-01",
  });

  const packDir = join(".eep", "packs", "stack", PACK_NAME);
  writeYaml(dir, join(packDir, "pack.yaml"), {
    name: PACK_NAME,
    kind: "stack",
    version: "1.0.0",
    implements: laws.map((law) => law.id),
  });
  writeYaml(dir, join(packDir, "checks", "manifest.yaml"), {
    checks: laws.map((law) => ({
      law: law.id,
      kind: "builtin",
      command: law.command,
      proves: "Fixture check.",
    })),
  });

  for (const law of laws) {
    const frontmatter: Record<string, unknown> = {
      id: law.id,
      title: `Fixture law ${law.id}`,
      severity: law.severity,
      maturity: "standard",
    };
    if (law.waivable !== undefined) frontmatter.waivable = law.waivable;
    const body = `---\n${stringifyYaml(frontmatter)}---\n\n## Statement\n\nFixture.\n`;
    write(dir, join(".eep", "doctrine", "fixture", "laws", `${law.id}.md`), body);
  }

  mkdirSync(join(dir, ".eep", "schemas"), { recursive: true });
  copyFileSync(
    join(root, "schemas", "waivers.schema.json"),
    join(dir, ".eep", "schemas", "waivers.schema.json"),
  );
}

function newFixtureDir(): string {
  return mkdtempSync(join(tmpdir(), "eep-verify-unit-"));
}

describe("runVerify over a builtin only fixture", () => {
  const dirs: string[] = [];

  function fixtureWith(laws: FixtureLaw[], packs?: unknown): string {
    const dir = newFixtureDir();
    dirs.push(dir);
    buildEepTree(dir, laws, packs);
    return dir;
  }

  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  it("counts a failing warning law as a warning, not a blocking failure", async () => {
    const dir = fixtureWith([
      { id: "EEP-OBS-01", severity: "warning", command: "file-contains absent.txt marker" },
      { id: "EEP-DOCS-02", severity: "blocking", command: "docs-style ." },
    ]);

    const report = await runVerify(dir);

    expect(find(report.results, "EEP-OBS-01")?.status).toBe("fail");
    expect(find(report.results, "EEP-DOCS-02")?.status).toBe("pass");
    expect(report.failedBlocking).toBe(0);
    expect(report.warnings).toBe(1);
  });

  it("counts a failing blocking law as a blocking failure", async () => {
    const dir = fixtureWith([
      { id: "EEP-DEVX-01", severity: "blocking", command: "file-contains Makefile setup" },
    ]);

    const report = await runVerify(dir);

    expect(find(report.results, "EEP-DEVX-01")?.status).toBe("fail");
    expect(report.failedBlocking).toBe(1);
    expect(report.warnings).toBe(0);
  });

  it("keeps the original failure detail alongside the waiver text", async () => {
    const dir = fixtureWith([
      { id: "EEP-DEVX-01", severity: "blocking", command: "file-contains Makefile setup" },
    ]);
    write(
      dir,
      join(".eep", "waivers.yaml"),
      waiverYaml("2026-11-01").replace("EEP-DOCS-02", "EEP-DEVX-01"),
    );

    const report = await runVerify(dir);
    const result = find(report.results, "EEP-DEVX-01");

    expect(result?.status).toBe("waived");
    expect(result?.detail).toContain("original: Makefile does not exist");
    expect(report.failedBlocking).toBe(0);
  });

  it("refuses a waiver on a law the corpus marks unwaivable", async () => {
    const dir = fixtureWith([
      { id: "EEP-SEC-01", severity: "blocking", command: "secrets-scan", waivable: false },
    ]);
    write(dir, "leak.py", AWS_KEY_LINE);
    write(
      dir,
      join(".eep", "waivers.yaml"),
      waiverYaml("2026-11-01").replace("EEP-DOCS-02", "EEP-SEC-01"),
    );

    const report = await runVerify(dir);
    const secrets = find(report.results, "EEP-SEC-01");

    expect(secrets?.status).toBe("fail");
    expect(secrets?.detail).toContain("waiver refused: EEP-SEC-01 is never waivable");
    const waiverFail = find(report.results, "EEP-GOV-WAIVER");
    expect(waiverFail?.status).toBe("fail");
    expect(waiverFail?.severity).toBe("blocking");
    expect(waiverFail?.detail).toContain("illegal");
    expect(report.failedBlocking).toBeGreaterThanOrEqual(1);
  });

  it("still honors a waiver on a law that carries no waivable flag", async () => {
    const dir = fixtureWith([{ id: "EEP-DOCS-02", severity: "blocking", command: "docs-style ." }]);
    write(dir, "note.md", `# Note\n\nOne thing ${EM_DASH} then another.\n`);
    write(dir, join(".eep", "waivers.yaml"), waiverYaml("2026-11-01"));

    const report = await runVerify(dir);

    expect(find(report.results, "EEP-DOCS-02")?.status).toBe("waived");
    expect(find(report.results, "EEP-GOV-WAIVER")).toBeUndefined();
    expect(report.failedBlocking).toBe(0);
  });

  it("fails closed when the lock resolves to zero laws", async () => {
    const dir = fixtureWith([], []);

    await expect(runVerify(dir)).rejects.toThrow(
      "eep: resolved zero laws; lock.yaml packs are missing or invalid, run eep adopt again",
    );
  });

  it("throws naming a lock pack entry that has no name", async () => {
    const dir = fixtureWith(
      [{ id: "EEP-DOCS-02", severity: "blocking", command: "docs-style ." }],
      [{ version: "1.0.0" }],
    );

    await expect(runVerify(dir)).rejects.toThrow("packs[0] has no name");
  });
});

// The target sits one directory down from the git root on purpose: without --relative, git reports
// paths from the repository root, they resolve against targetDir into paths that exist nowhere,
// and the narrowed set silently comes back empty. This is the test that catches that.
describe("runVerify --changed inside a nested package", () => {
  let repo: string;
  let target: string;

  beforeAll(async () => {
    repo = mkdtempSync(join(tmpdir(), "eep-verify-monorepo-"));
    target = join(repo, "packages", "svc");
    mkdirSync(target, { recursive: true });
    buildEepTree(target, [{ id: "EEP-DOCS-02", severity: "blocking", command: "docs-style ." }]);
    write(target, "tracked.md", "# Tracked\n\nClean prose.\n");
    write(target, "stale.md", `# Stale\n\nOld prose ${EM_DASH} never touched since.\n`);

    await execa("git", ["init", "--quiet"], { cwd: repo });
    await execa("git", ["add", "-A"], { cwd: repo });
    await execa(
      "git",
      [
        "-c",
        "user.email=fixture@example.invalid",
        "-c",
        "user.name=EEP Fixture",
        "commit",
        "--quiet",
        "-m",
        "fixture",
      ],
      { cwd: repo },
    );
  });

  afterAll(() => {
    if (repo !== undefined) rmSync(repo, { recursive: true, force: true });
  });

  it("scans everything without --changed", async () => {
    const report = await runVerify(target);

    expect(find(report.results, "EEP-DOCS-02")?.status).toBe("fail");
    expect(find(report.results, "EEP-DOCS-02")?.detail).toContain("stale.md");
  });

  it("scans nothing when the working tree matches HEAD", async () => {
    const report = await runVerify(target, { changed: true });
    const docs = find(report.results, "EEP-DOCS-02");

    expect(docs?.status).toBe("pass");
    expect(docs?.detail).toContain("in 0 markdown files (changed files only)");
    expect(report.failedBlocking).toBe(0);
  });

  it("scans exactly the changed file, with paths resolved relative to the target", async () => {
    write(target, "tracked.md", `# Tracked\n\nNow dirty ${EM_DASH} and changed.\n`);

    const report = await runVerify(target, { changed: true });
    const docs = find(report.results, "EEP-DOCS-02");

    expect(docs?.status).toBe("fail");
    expect(docs?.detail).toContain("tracked.md");
    expect(docs?.detail).not.toContain("stale.md");
  });
});

describe("runVerify without an adopted tree", () => {
  it("throws pointing at eep adopt", async () => {
    const empty = mkdtempSync(join(tmpdir(), "eep-verify-empty-"));
    try {
      await expect(runVerify(empty)).rejects.toThrow("eep: no .eep found; run eep adopt first");
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
