import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { loadPack } from "./pack.js";

// The lock file's own format version. Deliberately not sourced from src/version.ts: that constant
// tracks the eep CLI binary's release version, which can move independently of the lock.yaml shape
// this module writes. Bump this only when the lock.yaml shape itself changes.
const PROGRAM_VERSION = "0.1.0";

const SCAFFOLD_DIR_NAME = "scaffold";

type LockPack = { name: string; version: string };

type Lock = {
  program_version: string;
  profile: string;
  packs: LockPack[];
  vendored: string;
};

type ResolvedPack = {
  packName: string;
  packDir: string;
  version: string;
  implementsIds: string[];
};

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

// Packs live at packs/<kind>/<name>/ (kind is "stack", "platform", or "delivery" per
// pack.schema.json). Callers only supply <name>, so every kind directory is checked for a match;
// kind names are sorted first so the search order (and therefore which one wins on a hypothetical
// name collision across kinds) is deterministic.
function findPackDir(root: string, packName: string): string | undefined {
  const packsRoot = join(root, "packs");
  if (!existsSync(packsRoot)) return undefined;
  const kinds = readdirSync(packsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const kind of kinds) {
    const candidate = join(packsRoot, kind, packName);
    if (existsSync(join(candidate, "pack.yaml"))) return candidate;
  }
  return undefined;
}

// Resolves and validates every requested pack before anything is written to targetDir, so an
// unknown pack name throws before an existing, valid .eep vendor tree is torn down.
function resolvePacks(root: string, packNames: string[]): ResolvedPack[] {
  return packNames.map((packName) => {
    const packDir = findPackDir(root, packName);
    if (packDir === undefined) {
      throw new Error(`eep: pack ${packName} not found in corpus`);
    }
    const pack = loadPack(packDir);
    const version = pack.manifest.version;
    if (typeof version !== "string") {
      throw new Error(`eep: pack ${packName} has no version in its manifest`);
    }
    return {
      packName,
      packDir,
      version,
      implementsIds: toStringArray(pack.manifest.implements),
    };
  });
}

function copyFilesWithExtension(srcDir: string, destDir: string, extension: string): void {
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(extension)) {
      copyFileSync(join(srcDir, entry.name), join(destDir, entry.name));
    }
  }
}

// Copies a pack directory in full except its scaffold/ subtree (the project template scaffold
// consumers materialize separately, not part of the doctrine/tooling vendor set). cpSync's filter
// is evaluated top down, so returning false for the scaffold directory itself skips its entire
// contents without needing to check every descendant path individually.
function copyPackExcludingScaffold(packDir: string, destDir: string): void {
  cpSync(packDir, destDir, {
    recursive: true,
    filter: (source) => relative(packDir, source) !== SCAFFOLD_DIR_NAME,
  });
}

// Copies only the doctrine law files whose id is implemented by one of the vendored packs,
// preserving the <domain>/laws/<id>.md structure. Matching is filename based (law files are named
// exactly `${id}.md`, enforced by corpus validation's law-filename rule) rather than parsed from
// each file's frontmatter, so a malformed doctrine file that no vendored pack implements can never
// cause vendoring to fail.
function copyDoctrineLaws(root: string, eepDir: string, lawIds: Set<string>): void {
  const doctrineRoot = join(root, "doctrine");
  if (lawIds.size === 0 || !existsSync(doctrineRoot)) return;

  const domains = readdirSync(doctrineRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const domain of domains) {
    const lawsDir = join(doctrineRoot, domain, "laws");
    if (!existsSync(lawsDir)) continue;
    for (const lawId of lawIds) {
      const lawFile = join(lawsDir, `${lawId}.md`);
      if (!existsSync(lawFile)) continue;
      const destDir = join(eepDir, "doctrine", domain, "laws");
      mkdirSync(destDir, { recursive: true });
      copyFileSync(lawFile, join(destDir, `${lawId}.md`));
    }
  }
}

/**
 * Vendors the corpus (constitution, schemas, profiles, the named packs, and the doctrine law
 * files those packs implement) plus a pinned lock.yaml into `${targetDir}/.eep/`.
 *
 * Deviation from the Task 15 brief: packs land at `.eep/packs/<kind>/<name>/`, preserving the
 * corpus's kind subdirectory, instead of the brief's `.eep/packs/<name>/`. This keeps the vendored
 * tree shaped exactly like the corpus (packs, then a kind directory, then a name directory, then
 * pack.yaml), so the glob shape resolve and detect use against the corpus also matches a vendored
 * .eep tree unchanged.
 *
 * Re-vendoring is idempotent: any existing `.eep` directory is removed first, so the result always
 * reflects only the latest call's arguments.
 */
export function vendorInto(
  targetDir: string,
  corpusDir: string,
  packNames: string[],
  profile: string,
): void {
  const root = resolve(corpusDir);
  const resolvedPacks = resolvePacks(root, packNames);

  const eepDir = join(resolve(targetDir), ".eep");
  rmSync(eepDir, { recursive: true, force: true });
  mkdirSync(eepDir, { recursive: true });

  copyFileSync(join(root, "CONSTITUTION.md"), join(eepDir, "CONSTITUTION.md"));
  copyFilesWithExtension(join(root, "schemas"), join(eepDir, "schemas"), ".json");
  copyFilesWithExtension(join(root, "profiles"), join(eepDir, "profiles"), ".yaml");

  const implementsUnion = new Set<string>();
  const lockPacks: LockPack[] = [];
  for (const resolved of resolvedPacks) {
    const destDir = join(eepDir, relative(root, resolved.packDir));
    copyPackExcludingScaffold(resolved.packDir, destDir);
    for (const id of resolved.implementsIds) implementsUnion.add(id);
    lockPacks.push({ name: resolved.packName, version: resolved.version });
  }

  copyDoctrineLaws(root, eepDir, implementsUnion);

  const lock: Lock = {
    program_version: PROGRAM_VERSION,
    profile,
    packs: lockPacks,
    vendored: new Date().toISOString().slice(0, 10),
  };
  writeFileSync(join(eepDir, "lock.yaml"), stringifyYaml(lock));
}
