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
import { VERSION } from "../version.js";
import { findPackDir, loadPack } from "./pack.js";
import type { Profile } from "./resolve.js";

const SCAFFOLD_DIR_NAME = "scaffold";

// The single file inside .eep/ the consumer, not the corpus, owns. Read before the tree is torn
// down and written back afterwards, as raw bytes rather than parsed YAML, so a re-adopt returns
// the exact document the consumer had (comments, ordering, and trailing whitespace included).
const WAIVERS_FILE_NAME = "waivers.yaml";

// `workdir` is the pinned, effective one: present only when the pack declared a workdir and that
// directory existed in the target at sync time. Absent means "this pack's checks run at the root",
// and verify treats its absence as authoritative rather than looking for the directory again.
type LockPack = { name: string; version: string; workdir?: string };

/**
 * One pack and the component directory it governs in this target, or null for a pack whose
 * contribution is repository level.
 *
 * The same fact the lock records, in the shape the readers of it want: the agent file generator
 * decides its whole layout from this (see lib/generate.ts), and the commands that print a plan
 * before writing anything need it one step earlier, before a lock exists to read.
 */
export type PackLayout = { name: string; workdir: string | null };

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
  declaredWorkdir: string | null;
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
      declaredWorkdir: typeof pack.manifest.workdir === "string" ? pack.manifest.workdir : null,
    };
  });
}

/**
 * Resolves a pack's declared workdir against the target, once, at sync time.
 *
 * The manifest says where a pack's component lives when there is one; whether there is one is a
 * fact about this repository, and it is decided here and written into the lock. Deciding it again
 * at verify time, by looking for the directory, is what made the gate guessable: a single component
 * repository that happened to grow an unrelated `backend/` directory would silently move every one
 * of that pack's checks into it, and a green repository would go red (or worse, stay green while
 * checking the wrong tree). Pinning it means only a re-sync can move a pack's checks.
 */
function pinWorkdir(targetDir: string, declared: string | null): string | undefined {
  if (declared === null) return undefined;
  return existsSync(join(targetDir, declared)) ? declared : undefined;
}

/**
 * The layout a sync of `packNames` into `targetDir` would pin, computed from the corpus and the
 * target alone.
 *
 * Same rule and same inputs as the sync itself (see pinWorkdir), so a plan printed before the
 * write names exactly the files the write produces. Throws for a pack the corpus does not carry,
 * which is what every caller wants: they are about to vendor that same set.
 */
export function planPackLayout(
  targetDir: string,
  corpusDir: string,
  packNames: string[],
): PackLayout[] {
  const target = resolve(targetDir);
  return resolvePacks(resolve(corpusDir), packNames).map((pack) => ({
    name: pack.name,
    workdir: pinWorkdir(target, pack.declaredWorkdir) ?? null,
  }));
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
  const target = resolve(targetDir);
  const resolvedPacks = resolvePacks(root, packNames);

  const eepDir = join(target, ".eep");
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
    const workdir = pinWorkdir(target, resolved.declaredWorkdir);
    lockPacks.push(
      workdir === undefined
        ? { name: resolved.name, version: resolved.version }
        : { name: resolved.name, version: resolved.version, workdir },
    );
  }

  copyDoctrineLaws(root, eepDir, implementsUnion);

  // The eep that wrote this lock, not a format version of its own. It was a hardcoded 0.1.0 for as
  // long as the field existed, so every lock any release ever wrote claimed the same thing and the
  // field answered no question at all. A 0.1.2 binary reading a 0.2.0 lock ignored the pinned
  // workdirs it did not understand and reported three failures nobody could explain, which is
  // exactly the skew this field exists to make visible (see commands/verify.ts).
  const lock: Lock = {
    program_version: VERSION,
    profile,
    packs: lockPacks,
    vendored: new Date().toISOString().slice(0, 10),
  };
  writeFileSync(join(eepDir, "lock.yaml"), stringifyYaml(lock));

  if (preservedWaivers !== null) writeFileSync(waiversPath, preservedWaivers);
}
