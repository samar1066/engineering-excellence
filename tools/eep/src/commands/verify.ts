import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Command } from "commander";
import { execa } from "execa";
import { parse as parseYaml } from "yaml";
import { type BuiltinResult, runBuiltin } from "../lib/checks.js";
import type { CheckEntry } from "../lib/pack.js";
import { type Profile, type ResolvedLaw, resolveLaws } from "../lib/resolve.js";
import { loadWaivers, type Waiver } from "../lib/waivers.js";

export type VerifyResult = {
  law: string;
  status: "pass" | "fail" | "waived" | "skipped";
  severity: string;
  detail: string;
};

export type VerifyReport = { results: VerifyResult[]; failedBlocking: number; warnings: number };

// The law id every waiver file problem is reported under. Not a doctrine law: it is the governance
// of waivers themselves, and it always blocks, because an expired or malformed waiver otherwise
// silently stops suppressing the failure it was written for.
const WAIVER_LAW = "EEP-GOV-WAIVER";

const MAX_DETAIL_CHARS = 200;

const STATUS_LABEL = {
  pass: "PASS",
  fail: "FAIL",
  waived: "WAIVED",
  skipped: "SKIP",
} as const;

type ChangedScope = { restrictTo: string[] | null; note: string };

const FULL_SCOPE: ChangedScope = { restrictTo: null, note: "" };

function readYamlObject(path: string): Record<string, unknown> {
  const parsed: unknown = parseYaml(readFileSync(path, "utf8"));
  if (parsed === null || typeof parsed !== "object") return {};
  return parsed as Record<string, unknown>;
}

// lock.yaml's packs entries are {name, version} objects written by vendor.ts; only the name drives
// law resolution.
function toPackNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object") continue;
    const name = (entry as { name?: unknown }).name;
    if (typeof name === "string") names.push(name);
  }
  return names;
}

function toProfile(value: unknown): Profile {
  if (value === "greenfield" || value === "evolving" || value === "steady") return value;
  throw new Error(`eep: unknown profile "${String(value)}" in .eep/lock.yaml`);
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map((item) => asText(item)).join("\n");
  if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
  return String(value);
}

function tail(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= MAX_DETAIL_CHARS ? trimmed : trimmed.slice(-MAX_DETAIL_CHARS);
}

/**
 * Resolves which files `docs-style` is allowed to look at under `--changed`.
 *
 * Only `docs-style` is narrowed. Every other check is either cheap (a single file read) or repo
 * wide by nature (a secrets scan, a test suite, a lockfile freshness check), and narrowing those
 * would change what they prove rather than just how long they take. When git cannot answer, the
 * full tree is scanned instead and the reason is carried into the result detail: a gate that
 * quietly checked less than it claimed would be worse than one that checked more.
 */
async function changedScope(targetDir: string): Promise<ChangedScope> {
  try {
    const result = await execa("git", ["diff", "--name-only", "HEAD"], {
      cwd: targetDir,
      reject: false,
      all: true,
    });
    if (result.exitCode !== 0) {
      return { restrictTo: null, note: " (git diff failed; scanned the full tree)" };
    }
    const files = asText(result.stdout)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
    return { restrictTo: files, note: "" };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { restrictTo: null, note: ` (git unavailable: ${reason}; scanned the full tree)` };
  }
}

async function runShellCheck(entry: CheckEntry, targetDir: string): Promise<BuiltinResult> {
  const result = await execa(entry.command, {
    cwd: targetDir,
    shell: true,
    reject: false,
    all: true,
  });

  const output = asText(result.all) || `${asText(result.stdout)}\n${asText(result.stderr)}`;
  const exitCode = result.exitCode ?? 1;
  const matched =
    entry.fail_if_stdout_matches !== undefined && output.includes(entry.fail_if_stdout_matches);

  if (exitCode === 0 && !matched) return { ok: true, detail: "ok" };
  if (matched) {
    return {
      ok: false,
      detail: `output matched "${entry.fail_if_stdout_matches}": ${tail(output)}`,
    };
  }
  const detail = tail(output);
  return { ok: false, detail: detail === "" ? `exited ${exitCode} with no output` : detail };
}

async function runCheck(
  law: ResolvedLaw,
  targetDir: string,
  scope: ChangedScope,
): Promise<VerifyResult> {
  const check = law.check;
  if (check === null) {
    return {
      law: law.id,
      status: "skipped",
      severity: law.severity,
      detail: "no check is defined for this law in the active packs",
    };
  }

  if (check.kind === "builtin") {
    const isDocsStyle = check.command.trim().split(/\s+/)[0] === "docs-style";
    const restrictTo = isDocsStyle && scope.restrictTo !== null ? scope.restrictTo : undefined;
    const result = runBuiltin(check.command, targetDir, restrictTo);
    const note = isDocsStyle ? scope.note : "";
    return {
      law: law.id,
      status: result.ok ? "pass" : "fail",
      severity: law.severity,
      detail: `${result.detail}${note}`,
    };
  }

  const result = await runShellCheck(check, targetDir);
  return {
    law: law.id,
    status: result.ok ? "pass" : "fail",
    severity: law.severity,
    detail: result.detail,
  };
}

// Scope semantics for this slice: a waiver applies when its law id matches, whatever its scope
// says. The scope field is still required and recorded so waivers stay reviewable, but per path
// glob matching (waiving a law for docs/** while it still blocks under app/**) lands with fan out,
// once check results carry the file paths a scope would be matched against.
function waiversByLaw(active: Waiver[]): Map<string, Waiver> {
  const byLaw = new Map<string, Waiver>();
  for (const waiver of active) {
    if (!byLaw.has(waiver.law)) byLaw.set(waiver.law, waiver);
  }
  return byLaw;
}

function applyWaiver(result: VerifyResult, waiver: Waiver): VerifyResult {
  return {
    ...result,
    status: "waived",
    detail: `waived: ${waiver.justification} (owner ${waiver.owner}, expires ${waiver.expires})`,
  };
}

/**
 * Runs every active law's check in `targetDir` and reports the outcome.
 *
 * Changed mode is entered only when `opts.changed === true`. The profile's own enforcement mode
 * does not switch it on: the pre commit hook passes `--changed` deliberately, while a bare
 * `eep verify` always checks everything, so that the command a person runs by hand can never
 * prove less than the command CI runs.
 */
export async function runVerify(
  targetDir: string,
  opts?: { changed?: boolean },
): Promise<VerifyReport> {
  const dir = resolve(targetDir);
  const lockPath = join(dir, ".eep", "lock.yaml");
  if (!existsSync(lockPath)) throw new Error("eep: no .eep found; run eep adopt first");

  const lock = readYamlObject(lockPath);
  const laws = resolveLaws(toPackNames(lock.packs), toProfile(lock.profile), join(dir, ".eep"));

  const scope = opts?.changed === true ? await changedScope(dir) : FULL_SCOPE;
  const { active, problems } = loadWaivers(dir);
  const byLaw = waiversByLaw(active);

  const results: VerifyResult[] = [];
  for (const law of laws) {
    if (law.declined !== null) {
      results.push({
        law: law.id,
        status: "skipped",
        severity: law.severity,
        detail: law.declined,
      });
      continue;
    }
    const result = await runCheck(law, dir, scope);
    const waiver = result.status === "fail" ? byLaw.get(law.id) : undefined;
    results.push(waiver === undefined ? result : applyWaiver(result, waiver));
  }

  for (const problem of problems) {
    results.push({
      law: WAIVER_LAW,
      status: "fail",
      severity: "blocking",
      detail: problem.detail,
    });
  }

  const failed = results.filter((result) => result.status === "fail");
  return {
    results,
    failedBlocking: failed.filter((result) => result.severity === "blocking").length,
    warnings: failed.filter(
      (result) => result.severity === "warning" || result.severity === "advisory",
    ).length,
  };
}

export function register(program: Command): void {
  program
    .command("verify")
    .description("run every active law check and gate on the blocking failures")
    .option("--changed", "narrow the markdown style sweep to files that differ from HEAD")
    .action(async (opts: { changed?: boolean }) => {
      const report = await runVerify(process.cwd(), { changed: opts.changed === true });
      for (const result of report.results) {
        console.log(`${STATUS_LABEL[result.status]} ${result.law} ${result.detail}`);
      }
      console.log(`verify: ${report.failedBlocking} failed, ${report.warnings} warnings`);
      if (report.failedBlocking > 0) process.exitCode = 1;
    });
}
