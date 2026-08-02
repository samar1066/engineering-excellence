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
import { formatRow, runVerify, type VerifyResult } from "../src/commands/verify.js";
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
      // The scaffold ships no docs directory, so the frontmatter law had nothing to judge. That is
      // a skip: reporting it as a pass claimed a check had run over documents that do not exist.
      expect(find(report.results, "EEP-DOCS-01")?.status).toBe("skipped");
      expect(find(report.results, "EEP-DOCS-01")?.detail).toBe("no docs directory to check");
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
  kind?: "builtin" | "shell";
  waivable?: boolean;
};

type FixturePack = { name: string; laws: FixtureLaw[]; workdir?: string };

const PACK_NAME = "fixture-pack";

function writeYaml(dir: string, relPath: string, value: unknown): void {
  write(dir, relPath, stringifyYaml(value));
}

function writePack(dir: string, pack: FixturePack): void {
  const packDir = join(".eep", "packs", "stack", pack.name);
  const manifest: Record<string, unknown> = {
    name: pack.name,
    kind: "stack",
    version: "1.0.0",
    implements: pack.laws.map((law) => law.id),
  };
  if (pack.workdir !== undefined) manifest.workdir = pack.workdir;
  writeYaml(dir, join(packDir, "pack.yaml"), manifest);
  writeYaml(dir, join(packDir, "checks", "manifest.yaml"), {
    checks: pack.laws.map((law) => ({
      law: law.id,
      kind: law.kind ?? "builtin",
      command: law.command,
      proves: "Fixture check.",
    })),
  });
}

// One law file per law id, however many packs implement it: doctrine states a law once, and packs
// bind to it. Writing it per pack would let two packs disagree about a law's own severity.
function writeLawFiles(dir: string, packs: FixturePack[]): void {
  const written = new Set<string>();
  for (const pack of packs) {
    for (const law of pack.laws) {
      if (written.has(law.id)) continue;
      written.add(law.id);
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
  }
}

function buildMultiPackEepTree(dir: string, packs: FixturePack[], lockPacks?: unknown): void {
  writeYaml(dir, join(".eep", "profiles", "greenfield.yaml"), {
    name: "greenfield",
    enforcement: "all",
    description: "Fixture profile.",
  });
  // The workdir goes into the lock, which is the only place verify reads it from. The manifest copy
  // written by writePack is the corpus's declaration; the lock is this repository's pinned answer,
  // and a fixture that only wrote the manifest would prove nothing about what verify actually does.
  writeYaml(dir, join(".eep", "lock.yaml"), {
    program_version: "0.1.0",
    profile: "greenfield",
    packs:
      lockPacks ??
      packs.map((pack) =>
        pack.workdir === undefined
          ? { name: pack.name, version: "1.0.0" }
          : { name: pack.name, version: "1.0.0", workdir: pack.workdir },
      ),
    vendored: "2026-08-01",
  });

  for (const pack of packs) writePack(dir, pack);
  writeLawFiles(dir, packs);

  mkdirSync(join(dir, ".eep", "schemas"), { recursive: true });
  copyFileSync(
    join(root, "schemas", "waivers.schema.json"),
    join(dir, ".eep", "schemas", "waivers.schema.json"),
  );
}

function buildEepTree(dir: string, laws: FixtureLaw[], packs?: unknown): void {
  buildMultiPackEepTree(dir, [{ name: PACK_NAME, laws }], packs);
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

  /**
   * A builtin with nothing to look at is the third answer, not a pass.
   *
   * `PASS EEP-DOCS-01 [pack] skipped: no docs directory` was one row saying two things: the label
   * claimed a check had run and the detail admitted it had not. It sat in the green column of every
   * composed repository that ships no docs tree. The row now reads SKIP, and, like a decline, it
   * gates nothing.
   */
  it("reports a builtin with nothing to check as SKIP, gating nothing", async () => {
    const dir = fixtureWith([
      { id: "EEP-DOCS-01", severity: "blocking", command: "docs-frontmatter docs" },
      { id: "EEP-DOCS-02", severity: "warning", command: "docs-style absent-docs" },
    ]);

    const report = await runVerify(dir);

    expect(report.results.filter((result) => result.law === "EEP-DOCS-01").map(formatRow)).toEqual([
      `SKIP EEP-DOCS-01 [${PACK_NAME}] no docs directory to check`,
    ]);
    expect(find(report.results, "EEP-DOCS-02")?.status).toBe("skipped");
    expect(report.failedBlocking).toBe(0);
    expect(report.warnings).toBe(0);
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

function findFor(results: VerifyResult[], law: string, pack: string): VerifyResult | undefined {
  return results.find((result) => result.law === law && result.pack === pack);
}

/**
 * A law two packs both implement has to be proved twice, once per pack.
 *
 * This is the defect the per pack execution change closes: the first pack's result used to stand
 * in for every other pack's, so a repository whose service passed the coverage law never ran the
 * frontend's coverage command at all, and reported green while half of it was unchecked.
 */
describe("runVerify with two packs implementing one law", () => {
  const dirs: string[] = [];

  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  function fixtureWith(packs: FixturePack[]): string {
    const dir = newFixtureDir();
    dirs.push(dir);
    buildMultiPackEepTree(dir, packs);
    return dir;
  }

  const SHARED = "EEP-DEVX-01";

  it("runs both packs' checks and reports one row for each", async () => {
    const dir = fixtureWith([
      {
        name: "pack-a",
        laws: [{ id: SHARED, severity: "blocking", command: "file-contains a.txt marker" }],
      },
      {
        name: "pack-b",
        laws: [{ id: SHARED, severity: "blocking", command: "file-contains b.txt marker" }],
      },
    ]);
    write(dir, "a.txt", "marker\n");

    const report = await runVerify(dir);
    const rows = report.results.filter((result) => result.law === SHARED);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.pack)).toEqual(["pack-a", "pack-b"]);
    expect(findFor(report.results, SHARED, "pack-a")?.status).toBe("pass");
    expect(findFor(report.results, SHARED, "pack-b")?.status).toBe("fail");
    expect(findFor(report.results, SHARED, "pack-b")?.detail).toContain("b.txt does not exist");
  });

  it("counts a blocking failure once per failing pack", async () => {
    const dir = fixtureWith([
      {
        name: "pack-a",
        laws: [{ id: SHARED, severity: "blocking", command: "file-contains a.txt marker" }],
      },
      {
        name: "pack-b",
        laws: [{ id: SHARED, severity: "blocking", command: "file-contains b.txt marker" }],
      },
    ]);

    const report = await runVerify(dir);

    expect(report.failedBlocking).toBe(2);
  });

  it("waives the law across every pack that failed it, and refuses an illegal waiver once", async () => {
    const dir = fixtureWith([
      {
        name: "pack-a",
        laws: [
          { id: "EEP-SEC-01", severity: "blocking", command: "secrets-scan", waivable: false },
        ],
      },
      {
        name: "pack-b",
        laws: [
          { id: "EEP-SEC-01", severity: "blocking", command: "secrets-scan", waivable: false },
        ],
      },
    ]);
    write(dir, "leak.py", AWS_KEY_LINE);
    write(
      dir,
      join(".eep", "waivers.yaml"),
      waiverYaml("2026-11-01").replace("EEP-DOCS-02", "EEP-SEC-01"),
    );

    const report = await runVerify(dir);
    const rows = report.results.filter((result) => result.law === "EEP-SEC-01");

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.status).toBe("fail");
      expect(row.detail).toContain("waiver refused");
    }
    // The illegal waiver is one document to delete, so it is reported once however many packs
    // refused it.
    expect(report.results.filter((result) => result.law === "EEP-GOV-WAIVER")).toHaveLength(1);
  });
});

/**
 * A pack pinned to workdir W owns the component at <target>/W. Its checks have to run there, or a
 * composed repository would run every pack's toolchain against the repository root, where none of
 * their files are.
 *
 * The pin comes from lock.yaml and nowhere else. Verify never looks for the directory itself, which
 * is what stops a repository from silently moving its own gate by creating a directory that happens
 * to share a pack's name for one.
 */
describe("runVerify with a pack pinned to a workdir", () => {
  const dirs: string[] = [];

  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  // null, not undefined, for "pin nothing": an explicit undefined argument re-triggers the default
  // parameter value, which would silently pin svc in the very test written to prove nothing is
  // pinned.
  function fixtureWith(laws: FixtureLaw[], workdir: string | null = "svc"): string {
    const dir = newFixtureDir();
    dirs.push(dir);
    buildMultiPackEepTree(dir, [
      { name: "svc-pack", laws, ...(workdir === null ? {} : { workdir }) },
    ]);
    return dir;
  }

  const DEVX: FixtureLaw = {
    id: "EEP-DEVX-01",
    severity: "blocking",
    command: "file-contains marker.txt hello",
  };

  it("resolves a builtin path argument under the pinned workdir", async () => {
    const dir = fixtureWith([DEVX]);
    write(dir, join("svc", "marker.txt"), "hello\n");

    const report = await runVerify(dir);
    const result = find(report.results, "EEP-DEVX-01");

    expect(result?.status).toBe("pass");
    expect(result?.pack).toBe("svc-pack");
  });

  // The reported path is the one a reader can act on. A bare "marker.txt does not exist" in a
  // repository with three components names a file that does not identify itself.
  it("names the path relative to the repository root, workdir included", async () => {
    const dir = fixtureWith([DEVX]);
    mkdirSync(join(dir, "svc"), { recursive: true });
    write(dir, "marker.txt", "hello\n");

    const report = await runVerify(dir);
    const result = find(report.results, "EEP-DEVX-01");

    expect(result?.status).toBe("fail");
    expect(result?.detail).toContain("svc/marker.txt does not exist");
  });

  it("reports a passing path the same rooted way", async () => {
    const dir = fixtureWith([DEVX]);
    write(dir, join("svc", "marker.txt"), "hello\n");

    const report = await runVerify(dir);

    expect(find(report.results, "EEP-DEVX-01")?.detail).toContain("svc/marker.txt contains");
  });

  it("runs a shell check with the pinned workdir as its working directory", async () => {
    const dir = fixtureWith([
      { id: "EEP-DEVX-01", severity: "blocking", kind: "shell", command: "test -f marker.txt" },
    ]);
    write(dir, join("svc", "marker.txt"), "hello\n");

    const report = await runVerify(dir);

    expect(find(report.results, "EEP-DEVX-01")?.status).toBe("pass");
  });

  // Never a silent fallback to the root: running a component's build somewhere that is not that
  // component would pass or fail for reasons that have nothing to do with it.
  it("fails naming the pin when the pinned workdir has since been deleted", async () => {
    const dir = fixtureWith([
      { id: "EEP-DEVX-01", severity: "blocking", kind: "shell", command: "test -f marker.txt" },
    ]);

    const report = await runVerify(dir);
    const result = find(report.results, "EEP-DEVX-01");

    expect(result?.status).toBe("fail");
    expect(result?.detail).toContain("pinned workdir svc does not exist");
  });

  /**
   * The reviewer's first probe, reproduced.
   *
   * A single component repository adopts a pack whose manifest declares `workdir: svc`, with no svc
   * directory, so the lock pins none. Somebody later adds an unrelated svc directory. Nothing about
   * the gate may change: the checks were pinned to the root at sync time and stay there until the
   * next sync says otherwise.
   */
  it("stays at the root when nothing was pinned, even after a directory of that name appears", async () => {
    const dir = fixtureWith([DEVX], null);
    write(dir, "marker.txt", "hello\n");

    const before = await runVerify(dir);
    expect(find(before.results, "EEP-DEVX-01")?.status).toBe("pass");

    write(dir, join("svc", "unrelated.txt"), "not a component\n");
    const after = await runVerify(dir);

    expect(find(after.results, "EEP-DEVX-01")?.status).toBe("pass");
    expect(after.failedBlocking).toBe(0);
  });
});

/**
 * Three builtins are facts about the repository, not about one component of it, so a pinned workdir
 * never narrows them.
 *
 * Documentation style is the one the reviewer caught: a composed repository's root README belongs to
 * no component, so with every pack scoped to its own directory nobody was checking the one document
 * a reader sees first.
 */
describe("runVerify repo wide builtins", () => {
  const dirs: string[] = [];

  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  function fixtureWith(packs: FixturePack[]): string {
    const dir = newFixtureDir();
    dirs.push(dir);
    buildMultiPackEepTree(dir, packs);
    return dir;
  }

  it("scans for secrets outside the pinned workdir", async () => {
    const dir = fixtureWith([
      {
        name: "svc-pack",
        workdir: "svc",
        laws: [{ id: "EEP-SEC-01", severity: "blocking", command: "secrets-scan" }],
      },
    ]);
    write(dir, join("svc", "clean.py"), "value = 1\n");
    write(dir, "leak.py", AWS_KEY_LINE);

    const report = await runVerify(dir);
    const secrets = find(report.results, "EEP-SEC-01");

    expect(secrets?.status).toBe("fail");
    expect(secrets?.detail).toContain("leak.py");
  });

  it("checks markdown style at the repository root, outside the pinned workdir", async () => {
    const dir = fixtureWith([
      {
        name: "svc-pack",
        workdir: "svc",
        laws: [{ id: "EEP-DOCS-02", severity: "blocking", command: "docs-style ." }],
      },
    ]);
    write(dir, join("svc", "clean.md"), "# Clean\n\nNothing wrong here.\n");
    write(dir, "README.md", `# Root\n\nOne thing ${EM_DASH} then another.\n`);

    const report = await runVerify(dir);
    const docs = find(report.results, "EEP-DOCS-02");

    expect(docs?.status).toBe("fail");
    expect(docs?.detail).toContain("README.md:3 banned-dash");
  });

  it("checks markdown frontmatter at the repository root, outside the pinned workdir", async () => {
    const dir = fixtureWith([
      {
        name: "svc-pack",
        workdir: "svc",
        laws: [{ id: "EEP-DOCS-01", severity: "blocking", command: "docs-frontmatter docs" }],
      },
    ]);
    write(dir, join("docs", "note.md"), "# Note\n\nNo frontmatter at all.\n");

    const report = await runVerify(dir);
    const docs = find(report.results, "EEP-DOCS-01");

    expect(docs?.status).toBe("fail");
    expect(docs?.detail).toContain("docs/note.md");
  });

  // CI configuration lives at the root of a repository, one copy for the whole tree, so a workdir
  // must not send this check hunting for a component local copy that should not exist.
  it("resolves a .github path argument from the root whatever is pinned", async () => {
    const dir = fixtureWith([
      {
        name: "svc-pack",
        workdir: "svc",
        laws: [
          {
            id: "EEP-DLV-01",
            severity: "blocking",
            command: "file-contains-any .github/workflows 'eep verify'",
          },
        ],
      },
    ]);
    mkdirSync(join(dir, "svc"), { recursive: true });
    write(dir, join(".github", "workflows", "ci.yml"), "steps:\n  - run: eep verify\n");

    const report = await runVerify(dir);

    expect(find(report.results, "EEP-DLV-01")?.status).toBe("pass");
  });

  // One question about one repository, asked by two packs, gets one answer. The rows are still one
  // per pack, so the report contract is unchanged; only the scanning is shared.
  it("fans one result to every pack's row for the same command", async () => {
    const dir = fixtureWith([
      {
        name: "pack-a",
        workdir: "a",
        laws: [{ id: "EEP-DOCS-02", severity: "blocking", command: "docs-style ." }],
      },
      {
        name: "pack-b",
        workdir: "b",
        laws: [{ id: "EEP-DOCS-02", severity: "blocking", command: "docs-style ." }],
      },
    ]);
    mkdirSync(join(dir, "a"), { recursive: true });
    mkdirSync(join(dir, "b"), { recursive: true });
    write(dir, "README.md", `# Root\n\nOne thing ${EM_DASH} then another.\n`);

    const report = await runVerify(dir);
    const rows = report.results.filter((result) => result.law === "EEP-DOCS-02");

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.pack)).toEqual(["pack-a", "pack-b"]);
    expect(rows[0]?.detail).toBe(rows[1]?.detail);
    expect(report.failedBlocking).toBe(2);
  });
});

/**
 * A waiver naming a pack buys out that pack's row and no other.
 *
 * Without this, the only way to excuse a legacy service from a law was to excuse every component of
 * it, which is how a waiver written for one directory silently stops gating the repository.
 */
describe("runVerify with pack scoped waivers", () => {
  const dirs: string[] = [];

  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  const FAILING: FixtureLaw = {
    id: "EEP-DEVX-01",
    severity: "blocking",
    command: "file-contains absent.txt marker",
  };

  function fixtureWith(waiver: string): string {
    const dir = newFixtureDir();
    dirs.push(dir);
    buildMultiPackEepTree(dir, [
      { name: "pack-a", laws: [FAILING] },
      { name: "pack-b", laws: [FAILING] },
    ]);
    write(dir, join(".eep", "waivers.yaml"), waiver);
    return dir;
  }

  function waiverFor(law: string, pack?: string): string {
    const lines = [
      `- law: ${law}`,
      ...(pack === undefined ? [] : [`  pack: ${pack}`]),
      "  scope: '**/*'",
      '  justification: "The legacy service is rewritten next sprint."',
      "  owner: '@fixture-owner'",
      "  created: 2026-08-01",
      "  expires: 2026-11-01",
      "",
    ];
    return lines.join("\n");
  }

  it("flips only the named pack's row and keeps gating on the other", async () => {
    const dir = fixtureWith(waiverFor("EEP-DEVX-01", "pack-a"));

    const report = await runVerify(dir);

    expect(findFor(report.results, "EEP-DEVX-01", "pack-a")?.status).toBe("waived");
    expect(findFor(report.results, "EEP-DEVX-01", "pack-b")?.status).toBe("fail");
    expect(report.failedBlocking).toBe(1);
    expect(findFor(report.results, "EEP-DEVX-01", "pack-a")?.detail).not.toContain(
      "applies to all packs",
    );
  });

  it("flips every pack's row when no pack is named, and says so", async () => {
    const dir = fixtureWith(waiverFor("EEP-DEVX-01"));

    const report = await runVerify(dir);
    const rows = report.results.filter((result) => result.law === "EEP-DEVX-01");

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.status).toBe("waived");
      expect(row.detail).toContain("(applies to all packs)");
      expect(row.detail).toContain("original: absent.txt does not exist");
    }
    expect(report.failedBlocking).toBe(0);
  });

  it("prefers the pack scoped waiver over an unscoped one for the same law", async () => {
    const dir = fixtureWith(
      `${waiverFor("EEP-DEVX-01", "pack-a")}${waiverFor("EEP-DEVX-01").replace(
        "The legacy service",
        "The blunt instrument",
      )}`,
    );

    const report = await runVerify(dir);
    const scoped = findFor(report.results, "EEP-DEVX-01", "pack-a");

    expect(scoped?.status).toBe("waived");
    expect(scoped?.detail).toContain("The legacy service");
    expect(scoped?.detail).not.toContain("applies to all packs");
    expect(findFor(report.results, "EEP-DEVX-01", "pack-b")?.detail).toContain(
      "The blunt instrument",
    );
  });
});

describe("formatRow", () => {
  it("prints status, law, pack, then detail", () => {
    expect(
      formatRow({
        law: "EEP-DEVX-01",
        pack: "python-fastapi",
        status: "pass",
        severity: "blocking",
        detail: 'Makefile contains "setup"',
      }),
    ).toBe('PASS EEP-DEVX-01 [python-fastapi] Makefile contains "setup"');
  });

  it("labels every status the report can carry", () => {
    const base = { law: "EEP-DEVX-01", pack: "svc", severity: "blocking" } as const;

    expect(formatRow({ ...base, status: "fail", detail: "d" })).toBe("FAIL EEP-DEVX-01 [svc] d");
    expect(formatRow({ ...base, status: "waived", detail: "d" })).toBe(
      "WAIVED EEP-DEVX-01 [svc] d",
    );
    expect(formatRow({ ...base, status: "skipped", detail: "d" })).toBe("SKIP EEP-DEVX-01 [svc] d");
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
