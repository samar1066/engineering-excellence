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
  // Which pack's check produced this row. Two packs implementing one law both run, so the law id
  // alone no longer identifies a result, and a reader looking at a failure has to be told which
  // component's toolchain reported it.
  pack: string;
  status: "pass" | "fail" | "waived" | "skipped";
  severity: "blocking" | "warning" | "advisory";
  detail: string;
};

export type VerifyReport = { results: VerifyResult[]; failedBlocking: number; warnings: number };

// The law id every waiver file problem is reported under. Not a doctrine law: it is the governance
// of waivers themselves, and it always blocks, because an expired or malformed waiver otherwise
// silently stops suppressing the failure it was written for.
const WAIVER_LAW = "EEP-GOV-WAIVER";

// The pack column for the rows that come from no pack at all. Waiver governance is a fact about
// the consumer's own waivers file, so the column names that file's subject rather than borrowing
// whichever pack happened to fail underneath it.
const WAIVER_PACK = "waivers";

const MAX_DETAIL_CHARS = 200;

const STATUS_LABEL = {
  pass: "PASS",
  fail: "FAIL",
  waived: "WAIVED",
  skipped: "SKIP",
} as const;

/**
 * One report line: status, law id, the pack that judged it, then the detail.
 *
 * Exported so the format is asserted against this function rather than inferred from the report
 * object. It is the gate's public surface: a person reading CI output and a script grepping it both
 * depend on the column order, and the pack column is what tells two rows for one law apart.
 */
export function formatRow(result: VerifyResult): string {
  return `${STATUS_LABEL[result.status]} ${result.law} [${result.pack}] ${result.detail}`;
}

type ChangedScope = { restrictTo: string[] | null; note: string };

const FULL_SCOPE: ChangedScope = { restrictTo: null, note: "" };

function readYamlObject(path: string): Record<string, unknown> {
  const parsed: unknown = parseYaml(readFileSync(path, "utf8"));
  if (parsed === null || typeof parsed !== "object") return {};
  return parsed as Record<string, unknown>;
}

/**
 * Reads the pack names out of lock.yaml's `packs` list, which vendor.ts writes as {name, version}
 * objects.
 *
 * Every failure throws rather than being filtered away. A lock file whose entries do not parse
 * would otherwise resolve to fewer laws, or none, and a gate that quietly checks less than it was
 * configured to check is worse than one that refuses to run.
 */
function toPackNames(value: unknown): string[] {
  if (value === undefined || value === null) {
    throw new Error("eep: .eep/lock.yaml has no packs list; run eep adopt again");
  }
  if (!Array.isArray(value)) {
    throw new Error("eep: .eep/lock.yaml packs must be a list; run eep adopt again");
  }
  return value.map((entry: unknown, index) => {
    if (entry === null || typeof entry !== "object") {
      throw new Error(`eep: .eep/lock.yaml packs[${index}] is not an object; run eep adopt again`);
    }
    const name = (entry as { name?: unknown }).name;
    if (typeof name !== "string" || name === "") {
      throw new Error(`eep: .eep/lock.yaml packs[${index}] has no name; run eep adopt again`);
    }
    return name;
  });
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

// Keeps the end of a command's output, where the failure reason usually is. The marker is not
// decoration: without it a truncated detail reads as the command's whole output, and a reader
// diagnosing a failure from a mid sentence fragment has no way to tell that anything came before.
const ELISION_MARKER = "... ";

function tail(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_DETAIL_CHARS) return trimmed;
  return `${ELISION_MARKER}${trimmed.slice(-MAX_DETAIL_CHARS)}`;
}

/**
 * Resolves which files `docs-style` is allowed to look at under `--changed`.
 *
 * Only `docs-style` is narrowed. Every other check is either cheap (a single file read) or repo
 * wide by nature (a secrets scan, a test suite, a lockfile freshness check), and narrowing those
 * would change what they prove rather than just how long they take. When git cannot answer, the
 * full tree is scanned instead and the reason is carried into the result detail: a gate that
 * quietly checked less than it claimed would be worse than one that checked more.
 *
 * The paths come back absolute. A pack that declares a workdir runs its builtins against that
 * subdirectory, so a list relative to the repository root would be re-resolved against the wrong
 * base and narrow the sweep to nothing; absolute paths mean the same files whichever directory a
 * pack's checks run from.
 */
async function changedScope(targetDir: string): Promise<ChangedScope> {
  try {
    // --relative makes git report paths relative to the invocation directory rather than to the
    // repository root, so a target that is a package inside a monorepo gets paths that resolve
    // against targetDir the way the builtins expect.
    const result = await execa("git", ["diff", "--name-only", "--relative", "HEAD"], {
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
      .filter((line) => line !== "")
      .map((relPath) => resolve(targetDir, relPath));
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

/**
 * Where one pack's checks run.
 *
 * A pack that declares `workdir: W` owns the component at `<target>/W`: its shell checks run with
 * that directory as their working directory, and its builtin file arguments resolve against it, so
 * a composed repository runs each pack's toolchain where that pack's code actually is.
 *
 * A declared workdir that does not exist falls back to the target root rather than failing. The
 * same pack has to keep working in the single component repository it was written for, where its
 * code sits at the root and no component directory was ever created.
 */
function workDirFor(law: ResolvedLaw, targetDir: string): string {
  if (law.workdir === null) return targetDir;
  const candidate = join(targetDir, law.workdir);
  return existsSync(candidate) ? candidate : targetDir;
}

function builtinName(command: string): string {
  return command.trim().split(/\s+/)[0] ?? "";
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
      pack: law.pack,
      status: "skipped",
      severity: law.severity,
      detail: "no check is defined for this law in the active packs",
    };
  }

  const runDir = workDirFor(law, targetDir);

  if (check.kind === "builtin") {
    const name = builtinName(check.command);
    // secrets-scan is the one builtin a workdir never narrows. A credential committed anywhere in
    // the repository is a repository wide failure, and scoping the scan to one component would let
    // the same leak pass in the directory next door.
    const base = name === "secrets-scan" ? targetDir : runDir;
    const isDocsStyle = name === "docs-style";
    const restrictTo = isDocsStyle && scope.restrictTo !== null ? scope.restrictTo : undefined;
    const result = runBuiltin(check.command, base, restrictTo);
    const note = isDocsStyle ? scope.note : "";
    return {
      law: law.id,
      pack: law.pack,
      status: result.ok ? "pass" : "fail",
      severity: law.severity,
      detail: `${result.detail}${note}`,
    };
  }

  const result = await runShellCheck(check, runDir);
  return {
    law: law.id,
    pack: law.pack,
    status: result.ok ? "pass" : "fail",
    severity: law.severity,
    detail: result.detail,
  };
}

// Scope semantics for this slice: a waiver applies when its law id matches, whatever its scope
// says, and therefore to every pack's row for that law. The scope field is still required and
// recorded so waivers stay reviewable, but per path glob matching (waiving a law for docs/** while
// it still blocks under app/**, or for one component while it blocks in another) lands with fan
// out, once check results carry the file paths a scope would be matched against.
function waiversByLaw(active: Waiver[]): Map<string, Waiver> {
  const byLaw = new Map<string, Waiver>();
  for (const waiver of active) {
    if (!byLaw.has(waiver.law)) byLaw.set(waiver.law, waiver);
  }
  return byLaw;
}

// The original failure detail is kept after the waiver text. A waived result still has to answer
// "what exactly is being waived here", both for the reviewer approving it and for whoever reads
// the log the day the waiver expires.
function applyWaiver(result: VerifyResult, waiver: Waiver): VerifyResult {
  const head = `waived: ${waiver.justification} (owner ${waiver.owner}, expires ${waiver.expires})`;
  return { ...result, status: "waived", detail: `${head}; original: ${result.detail}` };
}

// A law the corpus marks `waivable: false` cannot be bought out. The failure stands, the reason
// the waiver was refused is appended so nobody has to guess why their waiver did nothing, and the
// illegal waiver is separately reported so it gets deleted rather than left to rot in the file.
function refuseWaiver(result: VerifyResult, lawId: string): VerifyResult {
  return { ...result, detail: `${result.detail}; waiver refused: ${lawId} is never waivable` };
}

/**
 * Runs every active law's check in `targetDir` and reports the outcome.
 *
 * One row per (law, pack): a law two packs both implement runs twice, once per pack, each in that
 * pack's own workdir. Both rows count toward failedBlocking and warnings, so a repository is only
 * green when every component satisfies the law, not when the first component to be checked does.
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
  // Fail closed. Zero laws means the gate would report a clean pass while proving nothing at all,
  // which is the one outcome a gate must never produce by accident.
  if (laws.length === 0) {
    throw new Error(
      "eep: resolved zero laws; lock.yaml packs are missing or invalid, run eep adopt again",
    );
  }

  const scope = opts?.changed === true ? await changedScope(dir) : FULL_SCOPE;
  const { active, problems } = loadWaivers(dir);
  const byLaw = waiversByLaw(active);

  const results: VerifyResult[] = [];
  const refusedWaivers: string[] = [];

  // One illegal waiver is one governance failure, however many packs' rows it was refused on:
  // deleting it is a single action, and reporting it once per pack would just repeat the same
  // sentence back at whoever has to do it.
  const refusedLaws = new Set<string>();

  for (const law of laws) {
    if (law.declined !== null) {
      results.push({
        law: law.id,
        pack: law.pack,
        status: "skipped",
        severity: law.severity,
        detail: law.declined,
      });
      continue;
    }
    const result = await runCheck(law, dir, scope);
    const waiver = result.status === "fail" ? byLaw.get(law.id) : undefined;
    if (waiver === undefined) {
      results.push(result);
      continue;
    }
    if (!law.waivable) {
      if (!refusedLaws.has(law.id)) {
        refusedLaws.add(law.id);
        refusedWaivers.push(
          `waiver for ${law.id} (owner ${waiver.owner}) is illegal: ${law.id} is never waivable`,
        );
      }
      results.push(refuseWaiver(result, law.id));
      continue;
    }
    results.push(applyWaiver(result, waiver));
  }

  for (const detail of [...problems.map((problem) => problem.detail), ...refusedWaivers]) {
    results.push({
      law: WAIVER_LAW,
      pack: WAIVER_PACK,
      status: "fail",
      severity: "blocking",
      detail,
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
      try {
        const report = await runVerify(process.cwd(), { changed: opts.changed === true });
        for (const result of report.results) {
          console.log(formatRow(result));
        }
        console.log(`verify: ${report.failedBlocking} failed, ${report.warnings} warnings`);
        if (report.failedBlocking > 0) process.exitCode = 1;
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
}
