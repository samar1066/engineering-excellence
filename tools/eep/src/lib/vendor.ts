import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import fg from "fast-glob";
import { stringify as stringifyYaml } from "yaml";
import { findPackDir, loadPack } from "./pack.js";
import type { Profile } from "./resolve.js";

// The lock file's own format version. Deliberately not sourced from src/version.ts: that constant
// tracks the eep CLI binary's release version, which can move independently of the lock.yaml shape
// this module writes. Bump this only when the lock.yaml shape itself changes.
const PROGRAM_VERSION = "0.1.0";

const SCAFFOLD_DIR_NAME = "scaffold";

// The single file inside .eep/ the consumer, not the corpus, owns. Read before the tree is torn
// down and written back afterwards, as raw bytes rather than parsed YAML, so a re-adopt returns
// the exact document the consumer had (comments, ordering, and trailing whitespace included).
const WAIVERS_FILE_NAME = "waivers.yaml";

type LockPack = { name: string; version: string };

type Lock = {
  program_version: string;
  profile: string;
  packs: LockPack[];
  vendored: string;
};

type ResolvedPack = {
  name: string;
  packDir: string;
  version: string;
  implementsIds: string[];
};

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

// Resolves and validates every requested pack before anything is written to targetDir, so an
// unknown pack name throws before an existing, valid .eep vendor tree is torn down.
function resolvePacks(root: string, packNames: string[]): ResolvedPack[] {
  return packNames.map((packName) => {
    const packDir = findPackDir(root, packName);
    const pack = loadPack(packDir);
    const version = pack.manifest.version;
    if (typeof version !== "string") {
      throw new Error(`eep: pack ${packName} has no version in its manifest`);
    }
    return {
      // The manifest's own name, not the requested packName string: today the two always agree
      // (findPackDir only returns a dir whose manifest name matched), but lock.yaml should record
      // the corpus's authoritative identity for the pack, not the caller's input spelling of it.
      name: pack.name,
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

// Copies the doctrine law files whose id is implemented by one of the vendored packs, preserving
// the <domain>/laws/<id>.md structure. Mirrors resolve.ts's findLawFile lookup, including its
// exact "not found" message, for the identical condition: a vendored tree must never silently
// omit a law an implements list promised, so a law id with no match anywhere under
// doctrine/*/laws/ is a hard error, not a skip.
function copyDoctrineLaws(root: string, eepDir: string, lawIds: Set<string>): void {
  for (const lawId of lawIds) {
    const matches = fg.sync(`doctrine/*/laws/${lawId}.md`, { cwd: root }).sort();
    const relPath = matches[0];
    if (relPath === undefined) {
      throw new Error(`eep: law ${lawId} not found in corpus`);
    }
    const destPath = join(eepDir, relPath);
    mkdirSync(dirname(destPath), { recursive: true });
    copyFileSync(join(root, relPath), destPath);
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
 * reflects only the latest call's arguments. The one exception is `.eep/waivers.yaml`, which is
 * carried across the rewrite byte for byte (see WAIVERS_FILE_NAME below): it is the consumer's own
 * document, not vendored corpus material, and re-adopting to pick up a corpus update must never
 * silently delete the approved, dated exceptions their gate depends on.
 */
export function vendorInto(
  targetDir: string,
  corpusDir: string,
  packNames: string[],
  profile: Profile,
): void {
  const root = resolve(corpusDir);
  const resolvedPacks = resolvePacks(root, packNames);

  const eepDir = join(resolve(targetDir), ".eep");
  const waiversPath = join(eepDir, WAIVERS_FILE_NAME);
  const preservedWaivers = existsSync(waiversPath) ? readFileSync(waiversPath) : null;

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
    lockPacks.push({ name: resolved.name, version: resolved.version });
  }

  copyDoctrineLaws(root, eepDir, implementsUnion);

  const lock: Lock = {
    program_version: PROGRAM_VERSION,
    profile,
    packs: lockPacks,
    vendored: new Date().toISOString().slice(0, 10),
  };
  writeFileSync(join(eepDir, "lock.yaml"), stringifyYaml(lock));

  if (preservedWaivers !== null) writeFileSync(waiversPath, preservedWaivers);
}
