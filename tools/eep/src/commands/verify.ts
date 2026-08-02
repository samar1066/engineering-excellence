import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Command } from "commander";
import { execa } from "execa";
import { parse as parseYaml } from "yaml";
import {
  type BuiltinResult,
  isRepoWideBuiltin,
  runBuiltin,
  scopeBuiltinToWorkdir,
} from "../lib/checks.js";
import type { CheckEntry } from "../lib/pack.js";
import { type Profile, type ResolvedLaw, resolveLaws } from "../lib/resolve.js";
import { loadWaivers, type Waiver } from "../lib/waivers.js";
import { VERSION } from "../version.js";

export type VerifyResult = {
  law: string;
  // Which pack's check produced this row. Two packs implementing one law both run, so the law id
  // alone no longer identifies a result, and a reader looking at a failure has to be told which
  // component's toolchain reported it.
  pack: string;
  // "skipped" has three sources, and none of them gate: a law the pack declined, a law no active
  // pack carries a check for, and a check whose subject is not in this repository at all (a docs
  // builtin pointed at a directory that does not exist). All three are reported as SKIP rather than
  // PASS, because a row that says PASS is a claim that something was proved.
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

type LockPack = { name: string; workdir: string | null };

/**
 * Reads lock.yaml's `packs` list, which vendor.ts writes as {name, version, workdir?} objects.
 *
 * The workdir is the pinned one: present only when that pack's component directory existed when the
 * repository was last synced. Absent means the pack's checks run at the root, and that absence is
 * authoritative. Verify never looks for the directory itself, so a repository cannot silently move
 * its own gate by creating a directory that happens to share a pack's workdir name.
 *
 * Every failure throws rather than being filtered away. A lock file whose entries do not parse
 * would otherwise resolve to fewer laws, or none, and a gate that quietly checks less than it was
 * configured to check is worse than one that refuses to run.
 */
function toLockPacks(value: unknown): LockPack[] {
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
    const workdir = (entry as { workdir?: unknown }).workdir;
    return { name, workdir: typeof workdir === "string" && workdir !== "" ? workdir : null };
  });
}

function pinnedWorkdirs(packs: LockPack[]): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const pack of packs) {
    if (pack.workdir !== null) map.set(pack.name, pack.workdir);
  }
  return map;
}

/**
 * The `<major>.<minor>` of a version string, or null when there is nothing to compare.
 *
 * Patch is deliberately dropped. A patch release fixes behavior without changing what a lock means,
 * so warning on it would train the reader to ignore the line by the time a release lands that
 * really does read the lock differently.
 */
function majorMinor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d+)\.(\d+)(?:\.|$)/.exec(value.trim());
  if (match === null) return null;
  return `${match[1]}.${match[2]}`;
}

/**
 * Says so when this CLI is not the CLI that wrote the lock it is about to act on.
 *
 * The failure this closes was three unexplainable failing rows: a globally installed 0.1.2 binary
 * ran against a lock a 0.2.0 sync had written, silently ignored the pinned workdirs it knew nothing
 * about, and ran every component's checks at the repository root. Nothing in the output suggested
 * the two halves were different programs.
 *
 * A warning, not a refusal, and it never touches the exit code: the gate's job is to report on the
 * repository, and a version difference is a fact about the reader's machine. It goes to stderr so a
 * script parsing the rows on stdout is unaffected, and it is emitted before any row is printed so it
 * frames the results it is about to explain rather than trailing them.
 */
function warnVersionSkew(lockVersion: unknown): void {
  const locked = majorMinor(lockVersion);
  if (locked === null || locked === majorMinor(VERSION)) return;
  console.error(
    `eep: warning: this project was synced by eep ${String(lockVersion)} and you are running ${VERSION}; re-run the sync or update the CLI if results look wrong`,
  );
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

function builtinName(command: string): string {
  return command.trim().split(/\s+/)[0] ?? "";
}

function builtinStatus(result: BuiltinResult): VerifyResult["status"] {
  if (result.skipped === true) return "skipped";
  return result.ok ? "pass" : "fail";
}

/**
 * Runs one law's check.
 *
 * Builtins always execute with the repository root as their base directory. A pack's pinned workdir
 * is folded into the command's path argument instead (see scopeBuiltinToWorkdir), so `file-contains
 * Makefile setup` from a pack pinned to `backend` becomes `file-contains backend/Makefile setup`.
 * That keeps every path a failure reports relative to the repository root, which is the only form a
 * reader can act on when two components carry a file of the same name.
 *
 * Repo wide builtins are computed once per command string and their result is shared across every
 * pack's row. Two packs carrying `docs-style .` are asking one question about one repository, and
 * scanning the tree once per pack would multiply the cost of the slowest checks by the number of
 * components while producing identical answers.
 */
async function runCheck(
  law: ResolvedLaw,
  targetDir: string,
  scope: ChangedScope,
  repoWideCache: Map<string, BuiltinResult>,
): Promise<VerifyResult> {
  const row = { law: law.id, pack: law.pack, severity: law.severity };
  const check = law.check;
  if (check === null) {
    return {
      ...row,
      status: "skipped",
      detail: "no check is defined for this law in the active packs",
    };
  }

  if (check.kind === "builtin") {
    const isDocsStyle = builtinName(check.command) === "docs-style";
    const restrictTo = isDocsStyle && scope.restrictTo !== null ? scope.restrictTo : undefined;
    const note = isDocsStyle ? scope.note : "";

    let result: BuiltinResult;
    if (isRepoWideBuiltin(check.command)) {
      const cached = repoWideCache.get(check.command);
      result = cached ?? runBuiltin(check.command, targetDir, restrictTo);
      if (cached === undefined) repoWideCache.set(check.command, result);
    } else {
      const command = scopeBuiltinToWorkdir(check.command, law.workdir ?? "");
      result = runBuiltin(command, targetDir, restrictTo);
    }

    // A builtin that reports skipped had nothing to look at, so it proved nothing. It is neither a
    // pass (which would put a green row in the gate for a check that never ran) nor a failure, and
    // it gates like a decline: reported, counted in neither total.
    return {
      ...row,
      status: builtinStatus(result),
      detail: `${result.detail}${note}`,
    };
  }

  // A pinned workdir that has since been deleted is reported as this pack's failure rather than
  // quietly falling back to the root. Falling back would run a component's build in a directory
  // that is not that component, and pass or fail for reasons that have nothing to do with it.
  const runDir = law.workdir === null ? targetDir : join(targetDir, law.workdir);
  if (!existsSync(runDir)) {
    return {
      ...row,
      status: "fail",
      detail: `pinned workdir ${law.workdir ?? ""} does not exist; re-run the sync for this repository`,
    };
  }

  const result = await runShellCheck(check, runDir);
  return { ...row, status: result.ok ? "pass" : "fail", detail: result.detail };
}

/**
 * The waiver that applies to one failing row, if any.
 *
 * A waiver naming a pack applies only to that pack's row: the coverage law can be bought out for a
 * legacy service without also excusing the frontend that was never in trouble. A waiver with no
 * pack applies to every pack's row for its law, which is the blunter instrument and says so in the
 * result detail. A pack scoped waiver wins over an unscoped one for the same law, since the more
 * specific statement is the more deliberate one.
 *
 * Path scope is still not matched. The `scope` field stays required and recorded so waivers remain
 * reviewable, but per path glob matching (waiving a law for docs/** while it still blocks under
 * app/**) needs check results to carry the file paths a scope would be matched against.
 */
function findWaiver(active: Waiver[], law: string, pack: string): Waiver | undefined {
  const forPack = active.find((waiver) => waiver.law === law && waiver.pack === pack);
  if (forPack !== undefined) return forPack;
  return active.find((waiver) => waiver.law === law && waiver.pack === undefined);
}

// One waiver, however many rows it touched: an illegal or expired waiver is a single line to delete
// from a single file, so it is keyed by the waiver rather than by the row.
function waiverKey(waiver: Waiver): string {
  return `${waiver.law}|${waiver.pack ?? "*"}`;
}

// The original failure detail is kept after the waiver text. A waived result still has to answer
// "what exactly is being waived here", both for the reviewer approving it and for whoever reads
// the log the day the waiver expires. An unscoped waiver says so, because "this is suppressing the
// law everywhere" is the part a reviewer most needs to see and the part the file itself does not
// spell out.
function applyWaiver(result: VerifyResult, waiver: Waiver): VerifyResult {
  const reach = waiver.pack === undefined ? " (applies to all packs)" : "";
  const head = `waived: ${waiver.justification} (owner ${waiver.owner}, expires ${waiver.expires})${reach}`;
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
  warnVersionSkew(lock.program_version);
  const lockPacks = toLockPacks(lock.packs);
  const laws = resolveLaws(
    lockPacks.map((pack) => pack.name),
    toProfile(lock.profile),
    join(dir, ".eep"),
    pinnedWorkdirs(lockPacks),
  );
  // Fail closed. Zero laws means the gate would report a clean pass while proving nothing at all,
  // which is the one outcome a gate must never produce by accident.
  if (laws.length === 0) {
    throw new Error(
      "eep: resolved zero laws; lock.yaml packs are missing or invalid, run eep adopt again",
    );
  }

  const scope = opts?.changed === true ? await changedScope(dir) : FULL_SCOPE;
  const { active, problems } = loadWaivers(dir);

  const results: VerifyResult[] = [];
  const refusedWaivers: string[] = [];
  const refused = new Set<string>();
  const repoWideCache = new Map<string, BuiltinResult>();

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
    const result = await runCheck(law, dir, scope, repoWideCache);
    const waiver = result.status === "fail" ? findWaiver(active, law.id, law.pack) : undefined;
    if (waiver === undefined) {
      results.push(result);
      continue;
    }
    if (!law.waivable) {
      const key = waiverKey(waiver);
      if (!refused.has(key)) {
        refused.add(key);
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
