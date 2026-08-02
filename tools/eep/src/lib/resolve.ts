import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import fg from "fast-glob";
import { parse as parseYaml } from "yaml";
import { readFrontmatter } from "./frontmatter.js";
import { type CheckEntry, findPackDir, loadPack } from "./pack.js";

export type Profile = "greenfield" | "evolving" | "steady";

export type ResolvedLaw = {
  id: string;
  title: string;
  severity: "blocking" | "warning" | "advisory";
  maturity: string;
  pack: string;
  check: CheckEntry | null;
  declined: string | null;
  changedOnly: boolean;
  waivable: boolean;
  // The pack manifest's optional `workdir`, carried here rather than re-read by every consumer:
  // an entry already names its pack, and verify has to know where that pack's checks run without
  // opening the manifest a second time. null means "the pack declared none": run at the root.
  workdir: string | null;
};

type DeclineEntry = { law: string; reason: string };

function parseYamlObject(path: string): Record<string, unknown> {
  const parsed: unknown = parseYaml(readFileSync(path, "utf8"));
  if (parsed === null || typeof parsed !== "object") return {};
  return parsed as Record<string, unknown>;
}

// Reads profiles/<profile>.yaml from the corpus. Missing file and reserved status are both
// caller-visible failure modes with their own exact error text, so they are checked here rather
// than left for callers to notice a malformed result.
function readProfile(corpusDir: string, profile: Profile): Record<string, unknown> {
  const path = join(corpusDir, "profiles", `${profile}.yaml`);
  if (!existsSync(path)) throw new Error(`eep: unknown profile ${profile}`);
  return parseYamlObject(path);
}

function findLawFile(corpusDir: string, id: string): string | null {
  const matches = fg.sync(`doctrine/*/laws/${id}.md`, { cwd: corpusDir }).sort();
  const first = matches[0];
  return first === undefined ? null : join(corpusDir, first);
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function toDeclineEntries(value: unknown): DeclineEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: DeclineEntry[] = [];
  for (const item of value) {
    if (item === null || typeof item !== "object") continue;
    const law = (item as { law?: unknown }).law;
    const reason = (item as { reason?: unknown }).reason;
    if (typeof law === "string" && typeof reason === "string") entries.push({ law, reason });
  }
  return entries;
}

function toSeverity(id: string, value: unknown): "blocking" | "warning" | "advisory" {
  if (value === "blocking" || value === "warning" || value === "advisory") return value;
  throw new Error(`eep: law ${id} has an invalid or missing severity`);
}

function toRequiredString(id: string, field: string, value: unknown): string {
  if (typeof value === "string") return value;
  throw new Error(`eep: law ${id} is missing ${field}`);
}

// Laws are waivable unless their frontmatter says otherwise, so the corpus only has to mark the
// exceptions. Only an explicit `waivable: false` withdraws the waiver path; a missing key, or any
// other value, leaves the law waivable.
function toWaivable(value: unknown): boolean {
  return value !== false;
}

// pack.yaml's `workdir` is optional (see schemas/pack.schema.json), so anything other than a
// non-empty string means the pack made no claim and its checks belong at the repository root.
function toWorkdir(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

// Declined entries fall back to the law id as a title when the law file cannot be found at all,
// since a decline is still reportable even for a law the corpus has not authored yet.
function readOptionalTitle(lawPath: string | null, fallback: string): string {
  if (lawPath === null) return fallback;
  const { data } = readFrontmatter(lawPath);
  return typeof data.title === "string" ? data.title : fallback;
}

/**
 * The active law set for a pack selection: one entry per (law id, pack) pair, sorted by law id and
 * then by pack name.
 *
 * A law two packs both implement resolves twice, once per pack, and both entries carry that pack's
 * own check. This is not redundancy: each pack proves the law over its own component with its own
 * toolchain, so a repository carrying a backend and a frontend has to satisfy the coverage law in
 * both, and one pack passing must never stand in for the other. Declines resolve per pack for the
 * same reason: a pack declining a law says nothing about whether its sibling implements it.
 */
export function resolveLaws(
  packNames: string[],
  profile: Profile,
  corpusDir: string,
): ResolvedLaw[] {
  const profileFile = readProfile(corpusDir, profile);
  if (profileFile.status === "reserved") {
    throw new Error("steady enforcement ships in a later release; run greenfield or evolving");
  }
  const changedOnly = profileFile.enforcement === "changed";

  const resolved: ResolvedLaw[] = [];

  for (const packName of packNames) {
    const dir = findPackDir(corpusDir, packName);
    const pack = loadPack(dir);
    const implementsList = toStringArray(pack.manifest.implements);
    const declineEntries = toDeclineEntries(pack.manifest.declines);
    const workdir = toWorkdir(pack.manifest.workdir);

    for (const id of implementsList) {
      const lawPath = findLawFile(corpusDir, id);
      if (lawPath === null) throw new Error(`eep: law ${id} not found in corpus`);
      const { data } = readFrontmatter(lawPath);
      const check = pack.checks.find((entry) => entry.law === id) ?? null;

      resolved.push({
        id,
        title: toRequiredString(id, "title", data.title),
        severity: toSeverity(id, data.severity),
        maturity: toRequiredString(id, "maturity", data.maturity),
        pack: packName,
        check,
        declined: null,
        changedOnly,
        waivable: toWaivable(data.waivable),
        workdir,
      });
    }

    for (const entry of declineEntries) {
      const lawPath = findLawFile(corpusDir, entry.law);
      resolved.push({
        id: entry.law,
        title: readOptionalTitle(lawPath, entry.law),
        severity: "advisory",
        maturity: "standard",
        pack: packName,
        check: null,
        declined: entry.reason,
        changedOnly,
        // A declined law has no check to fail, so nothing can ever be waived against it. The
        // permissive default is kept rather than reading the law file, so declines stay cheap.
        waivable: true,
        workdir,
      });
    }
  }

  resolved.sort((a, b) => a.id.localeCompare(b.id) || a.pack.localeCompare(b.pack));
  return resolved;
}
