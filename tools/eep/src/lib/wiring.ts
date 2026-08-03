import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { findPackDir, loadPack } from "./pack.js";

// The same token copyScaffold substitutes, applied here too: the wiring pass runs after copyScaffold,
// so a `{{project_name}}` an injected line carries (the note table's owner tag) would never otherwise
// be resolved. Kept in step with commands/init.ts's own PROJECT_NAME_TOKEN.
const PROJECT_NAME_TOKEN = "{{project_name}}";

// The manifest value that marks a data pack as one whose repository swaps into a backend. It is the
// trigger the composed wiring pass keys on, alongside the presence of a `wiring` block, so a data
// pack that ships a construct but no repository is never asked to rewrite a backend.
const REPOSITORY_PROVIDER = "repository";

/**
 * A pack's placement in the composed tree, narrowed to the two fields the wiring pass needs: which
 * pack, and the component directory its files were rendered into (null for a root placed pack).
 * commands/init.ts's richer Placement is assignable to this.
 */
export type WiringPlacement = {
  readonly pack: string;
  readonly componentDir: string | null;
};

export type WiringSummary = {
  // The provider packs whose wiring block was applied (a provides: repository pack with a wiring
  // block and at least one target in the composed set).
  providers: string[];
  // Component relative destinations written, patched, and had a dependency added, for the init log
  // line and for a caller that wants to report what the pass touched.
  copied: string[];
  patched: string[];
  dependenciesAdded: string[];
};

type ReplaceRule = { from: string; to: string };
type PatchEntry = { file: string; replace: ReplaceRule[] };
type CopyEntry = { from: string; to: string };
type DependencyEntry = { file: string; add: string[] };
type Recipe = { copy: CopyEntry[]; patch: PatchEntry[]; dependency: DependencyEntry[] };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

// `add` is one spec or a list of specs; both normalize to a list. A malformed entry (a number, say)
// is dropped rather than coerced, so only real spec strings reach the manifest edit.
function toAddList(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return asArray(value).filter((item): item is string => typeof item === "string");
}

function toReplaceRules(value: unknown): ReplaceRule[] {
  const rules: ReplaceRule[] = [];
  for (const entry of asArray(value)) {
    const record = asRecord(entry);
    const from = asString(record?.from);
    const to = asString(record?.to);
    if (from !== null && to !== null) rules.push({ from, to });
  }
  return rules;
}

function toRecipe(value: unknown): Recipe {
  const record = asRecord(value) ?? {};
  const copy: CopyEntry[] = [];
  for (const entry of asArray(record.copy)) {
    const c = asRecord(entry);
    const from = asString(c?.from);
    const to = asString(c?.to);
    if (from !== null && to !== null) copy.push({ from, to });
  }
  const patch: PatchEntry[] = [];
  for (const entry of asArray(record.patch)) {
    const p = asRecord(entry);
    const file = asString(p?.file);
    if (file !== null) patch.push({ file, replace: toReplaceRules(p?.replace) });
  }
  const dependency: DependencyEntry[] = [];
  for (const entry of asArray(record.dependency)) {
    const d = asRecord(entry);
    const file = asString(d?.file);
    const add = toAddList(d?.add);
    if (file !== null && add.length > 0) dependency.push({ file, add });
  }
  return { copy, patch, dependency };
}

// The recipe map is targets and infra merged: the wiring pass treats both identically (find the
// named pack in the composed set, apply the recipe against its component directory), and the two
// keys exist only to separate the backends a repository swaps into from the platform the construct
// composes into for a reader of the manifest.
function toRecipeMap(wiring: Record<string, unknown>): Map<string, Recipe> {
  const map = new Map<string, Recipe>();
  for (const group of [asRecord(wiring.targets), asRecord(wiring.infra)]) {
    if (group === null) continue;
    for (const [pack, recipe] of Object.entries(group)) {
      map.set(pack, toRecipe(recipe));
    }
  }
  return map;
}

// The leading distribution name of a PEP 508 requirement, so "aioboto3>=13.0.0" is recognized as
// already present whatever version bound follows it.
function pep508Name(spec: string): string {
  return spec.match(/^[A-Za-z0-9._-]+/)?.[0] ?? spec;
}

// Splits an npm spec "name@version" into its parts, honoring a scope: the last @ is the version
// separator, so "@aws-sdk/lib-dynamodb@^3.700.0" yields the scoped name and "^3.700.0". A spec with
// no version (no @ past position 0) takes "*".
function splitNpmSpec(spec: string): { name: string; version: string } {
  const at = spec.lastIndexOf("@");
  if (at > 0) return { name: spec.slice(0, at), version: spec.slice(at + 1) };
  return { name: spec, version: "*" };
}

/**
 * Inserts requirement specs into the [project] dependencies array of a pyproject.toml, before the
 * array's closing bracket, at the indentation the existing entries use.
 *
 * Text surgical rather than a TOML round trip: re-serializing would reflow every unrelated key and
 * comment. The [project] array is the first `dependencies = [` in the file (the dev group is keyed
 * `dev`, not `dependencies`), and each existing entry already carries a trailing comma, so appending
 * one more entry with its own trailing comma keeps the array valid without touching a prior line. A
 * spec whose distribution name is already listed is skipped, so the edit is idempotent.
 */
function insertPyprojectDependencies(content: string, specs: string[]): string {
  const lines = content.split("\n");
  const startIdx = lines.findIndex((line) => /^dependencies\s*=\s*\[/.test(line));
  if (startIdx === -1) {
    throw new Error("eep: wiring dependency: no [project] dependencies array in pyproject.toml");
  }
  let closeIdx = -1;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^\s*\]/.test(lines[i] ?? "")) {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) {
    throw new Error("eep: wiring dependency: unterminated dependencies array in pyproject.toml");
  }
  const existing = lines.slice(startIdx + 1, closeIdx).join("\n");
  const indent = (lines[startIdx + 1] ?? "").match(/^(\s+)\S/)?.[1] ?? "    ";
  const additions: string[] = [];
  for (const spec of specs) {
    if (existing.includes(`"${pep508Name(spec)}`)) continue;
    additions.push(`${indent}"${spec}",`);
  }
  if (additions.length === 0) return content;
  lines.splice(closeIdx, 0, ...additions);
  return lines.join("\n");
}

/**
 * Inserts packages into the "dependencies" object of a package.json, as its first entries.
 *
 * Prepended rather than appended for the same reason the pyproject edit appends: it never has to
 * touch an existing line. The last entry of a JSON object carries no trailing comma, so appending
 * would mean rewriting that entry to add one; inserting at the top, each with its own trailing comma,
 * stays valid JSON because a real entry always follows. Formatting of every existing line is left
 * exactly as the pack wrote it. A package already present is skipped.
 */
function insertPackageJsonDependencies(content: string, specs: string[]): string {
  const lines = content.split("\n");
  const depIdx = lines.findIndex((line) => /"dependencies"\s*:\s*\{/.test(line));
  if (depIdx === -1) {
    throw new Error('eep: wiring dependency: no "dependencies" object in package.json');
  }
  let closeIdx = -1;
  for (let i = depIdx + 1; i < lines.length; i++) {
    if (/^\s*\}/.test(lines[i] ?? "")) {
      closeIdx = i;
      break;
    }
  }
  const block = (
    closeIdx === -1 ? lines.slice(depIdx + 1) : lines.slice(depIdx + 1, closeIdx)
  ).join("\n");
  const parentIndent = (lines[depIdx] ?? "").match(/^(\s*)/)?.[1] ?? "";
  const indent = (lines[depIdx + 1] ?? "").match(/^(\s+)"/)?.[1] ?? `${parentIndent}  `;
  const additions: string[] = [];
  for (const spec of specs) {
    const { name, version } = splitNpmSpec(spec);
    if (block.includes(`"${name}"`)) continue;
    additions.push(`${indent}"${name}": "${version}",`);
  }
  if (additions.length === 0) return content;
  lines.splice(depIdx + 1, 0, ...additions);
  return lines.join("\n");
}

function insertDependencies(file: string, content: string, specs: string[]): string {
  const name = basename(file);
  if (name === "pyproject.toml") return insertPyprojectDependencies(content, specs);
  if (name === "package.json") return insertPackageJsonDependencies(content, specs);
  throw new Error(`eep: wiring dependency: unsupported manifest ${file}`);
}

function subst(text: string, name: string): string {
  return text.replaceAll(PROJECT_NAME_TOKEN, name);
}

function applyRecipe(args: {
  recipe: Recipe;
  sourcePackDir: string;
  componentDir: string;
  componentAbsDir: string;
  name: string;
  provider: string;
  target: string;
  summary: WiringSummary;
}): void {
  const { recipe, sourcePackDir, componentDir, componentAbsDir, name, provider, target, summary } =
    args;

  for (const entry of recipe.copy) {
    const src = join(sourcePackDir, entry.from);
    if (!existsSync(src)) {
      throw new Error(
        `eep: wiring ${provider} -> ${target}: copy source ${entry.from} does not exist at ${src}`,
      );
    }
    const dest = join(componentAbsDir, entry.to);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, subst(readFileSync(src, "utf8"), name));
    summary.copied.push(join(componentDir, entry.to));
  }

  for (const patch of recipe.patch) {
    const filePath = join(componentAbsDir, patch.file);
    if (!existsSync(filePath)) {
      throw new Error(
        `eep: wiring ${provider} -> ${target}: patch target ${patch.file} does not exist at ${filePath}`,
      );
    }
    let content = readFileSync(filePath, "utf8");
    for (const rule of patch.replace) {
      if (!content.includes(rule.from)) {
        throw new Error(
          `eep: wiring ${provider} -> ${target}: string not found in ${patch.file}: ${JSON.stringify(rule.from)}`,
        );
      }
      content = content.replaceAll(rule.from, subst(rule.to, name));
    }
    writeFileSync(filePath, content);
    summary.patched.push(join(componentDir, patch.file));
  }

  for (const dep of recipe.dependency) {
    const filePath = join(componentAbsDir, dep.file);
    if (!existsSync(filePath)) {
      throw new Error(
        `eep: wiring ${provider} -> ${target}: dependency target ${dep.file} does not exist at ${filePath}`,
      );
    }
    const updated = insertDependencies(dep.file, readFileSync(filePath, "utf8"), dep.add);
    writeFileSync(filePath, updated);
    for (const spec of dep.add)
      summary.dependenciesAdded.push(`${join(componentDir, dep.file)}: ${spec}`);
  }
}

/**
 * The composed init wiring pass.
 *
 * Runs over the rendered project tree after every pack scaffold is copied and before the tree is
 * committed, so a repository swap is committed with the scaffold rather than left as an untracked
 * edit. For each composed pack that declares `provides: repository` and a `wiring` block, and for
 * each of that block's targets that is also in the composed set, the target backend's in memory
 * repository is replaced by the provider's adapter behind the unchanged interface: the adapter file
 * is copied in, the composition root's import and construction are rewritten, and the storage client
 * dependency is added to the component's manifest. The infra recipe composes the provider's construct
 * into the platform stack the same way.
 *
 * Every failure is loud. A declared `from` string the rendered file does not contain, a copy source
 * that is missing, or a dependency manifest with no recognizable dependency list all throw, naming
 * the provider, the target, and the file, because a wiring that silently did nothing would ship an
 * application that reads as persisted and is not. A target that is not in the composed set is not a
 * failure: it is simply skipped, which is what lets one data pack declare wiring for several backends
 * and have only the composed ones rewritten.
 */
export function applyComposedWiring(args: {
  projectDir: string;
  corpusDir: string;
  name: string;
  placements: readonly WiringPlacement[];
}): WiringSummary {
  const { projectDir, corpusDir, name, placements } = args;
  const summary: WiringSummary = {
    providers: [],
    copied: [],
    patched: [],
    dependenciesAdded: [],
  };
  const byPack = new Map(placements.map((placement) => [placement.pack, placement]));

  for (const placement of placements) {
    const packDir = findPackDir(corpusDir, placement.pack);
    const manifest = loadPack(packDir).manifest;
    if (manifest.provides !== REPOSITORY_PROVIDER) continue;
    const wiring = asRecord(manifest.wiring);
    if (wiring === null) continue;

    const recipes = toRecipeMap(wiring);
    let applied = false;
    for (const [target, recipe] of recipes) {
      const targetPlacement = byPack.get(target);
      if (targetPlacement === undefined) continue;
      if (targetPlacement.componentDir === null) {
        throw new Error(
          `eep: wiring ${placement.pack} -> ${target}: target has no component directory to wire into`,
        );
      }
      applyRecipe({
        recipe,
        sourcePackDir: packDir,
        componentDir: targetPlacement.componentDir,
        componentAbsDir: join(projectDir, targetPlacement.componentDir),
        name,
        provider: placement.pack,
        target,
        summary,
      });
      applied = true;
    }
    if (applied) summary.providers.push(placement.pack);
  }

  return summary;
}
