import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execa } from "execa";
import fg from "fast-glob";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
