import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import fg from "fast-glob";
import { parse as parseYaml } from "yaml";
import { readFrontmatter } from "./frontmatter.js";
import { type CheckEntry, loadPack } from "./pack.js";

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

// Pack directories are not addressable by name directly; every pack manifest under the corpus
// must be loaded and compared until one with a matching name turns up.
function findPackDir(corpusDir: string, packName: string): string {
  const manifestPaths = fg.sync("packs/*/*/pack.yaml", { cwd: corpusDir }).sort();
  for (const relPath of manifestPaths) {
    const dir = dirname(join(corpusDir, relPath));
    if (loadPack(dir).name === packName) return dir;
  }
  throw new Error(`eep: pack ${packName} not found in corpus`);
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

// Declined entries fall back to the law id as a title when the law file cannot be found at all,
// since a decline is still reportable even for a law the corpus has not authored yet.
function readOptionalTitle(lawPath: string | null, fallback: string): string {
  if (lawPath === null) return fallback;
  const { data } = readFrontmatter(lawPath);
  return typeof data.title === "string" ? data.title : fallback;
}

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

  const seen = new Set<string>();
  const resolved: ResolvedLaw[] = [];

  for (const packName of packNames) {
    const dir = findPackDir(corpusDir, packName);
    const pack = loadPack(dir);
    const implementsList = toStringArray(pack.manifest.implements);
    const declineEntries = toDeclineEntries(pack.manifest.declines);

    for (const id of implementsList) {
      if (seen.has(id)) continue;
      seen.add(id);

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
      });
    }

    for (const entry of declineEntries) {
      if (seen.has(entry.law)) continue;
      seen.add(entry.law);

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
      });
    }
  }

  resolved.sort((a, b) => a.id.localeCompare(b.id));
  return resolved;
}
