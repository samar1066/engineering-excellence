import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import fg from "fast-glob";
import { parse as parseYaml } from "yaml";
import type { Violation } from "../commands/corpus.js";
import { readFrontmatter } from "./frontmatter.js";
import { repoRoot, validateAgainst } from "./schema.js";

export type CheckEntry = {
  law: string;
  kind: "shell" | "builtin";
  command: string;
  proves: string;
  fail_if_stdout_matches?: string;
};

export type Pack = {
  name: string;
  dir: string;
  manifest: Record<string, unknown>;
  checks: CheckEntry[];
};

type DoctrineLaw = { id: string; appliesTo: string[]; path: string; body: string };

// A law is in scope for the pack coverage contract (assertion 4) when its applies_to intersects
// this set. Every doctrine law observed so far carries exactly one of these four tags, so today
// this filter is a no-op in practice, but it is kept explicit rather than treating "every law" as
// the rule: a future tag outside this set (for example something frontend or mobile specific)
// should be free to exist without every stack pack being forced to implement or decline it.
const COVERAGE_APPLIES_TO = new Set(["all", "backend", "docs", "corpus"]);

// Inline markdown links only, matching the same shape corpus.ts's pack containment check uses:
// [text](target). Reference-style links, HTML anchors, and bare prose mentions are out of scope.
const LINK_PATTERN = /\[[^\]]*\]\(([^)]+)\)/g;

// Mirrors commands/corpus.ts's own describeParseError: a missing-file (ENOENT) or malformed-YAML
// error's first message line is already a concise, single-line description (js-yaml/yaml errors
// put a source snippet with a caret on the following lines; Node fs errors are one line already).
function describeParseError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const [firstLine] = message.split("\n");
  return (firstLine ?? message).trim();
}

function parseYamlObject(path: string): Record<string, unknown> {
  const parsed: unknown = parseYaml(readFileSync(path, "utf8"));
  if (parsed === null || typeof parsed !== "object") return {};
  return parsed as Record<string, unknown>;
}

function readChecksManifest(dir: string): CheckEntry[] {
  const checksPath = join(dir, "checks", "manifest.yaml");
  if (!existsSync(checksPath)) return [];
  const doc = parseYamlObject(checksPath);
  const checks = doc.checks;
  return Array.isArray(checks) ? (checks as CheckEntry[]) : [];
}

export function loadPack(packDir: string): Pack {
  const dir = resolve(packDir);
  const manifest = parseYamlObject(join(dir, "pack.yaml"));
  const checks = readChecksManifest(dir);
  const name = typeof manifest.name === "string" ? manifest.name : "";
  return { name, dir, manifest, checks };
}

/**
 * The directory of the pack named `packName`, under `<corpusDir>/packs/<kind>/<name>/`.
 *
 * Pack directories are not addressable by name directly: a pack's authoritative identity is its
 * manifest's own `name` field (see pack.schema.json), not the directory basename, so every manifest
 * under the corpus is loaded and compared, in sorted order, until one matches.
 *
 * Throws rather than returning undefined. Every caller (resolve, vendor, composed init) is about to
 * act on the pack it asked for, and a silently missing one would resolve fewer laws, vendor less
 * doctrine, or scaffold nothing, all of which look like success.
 */
export function findPackDir(corpusDir: string, packName: string): string {
  const manifestPaths = fg.sync("packs/*/*/pack.yaml", { cwd: corpusDir }).sort();
  for (const relPath of manifestPaths) {
    const dir = dirname(join(corpusDir, relPath));
    if (loadPack(dir).name === packName) return dir;
  }
  throw new Error(`eep: pack ${packName} not found in corpus`);
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function toDeclinedLawIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object") continue;
    const law = (entry as { law?: unknown }).law;
    if (typeof law === "string") ids.push(law);
  }
  return ids;
}

// Assertion 1: pack.yaml parses (loadPack already did that to get here) and validates against the
// pack schema. Schema failures are reported, not thrown, so the remaining assertions still run
// against whatever shape the manifest does have.
function checkManifestSchema(
  root: string,
  dir: string,
  manifest: Record<string, unknown>,
): Violation[] {
  const { valid, errors } = validateAgainst("pack", manifest);
  if (valid) return [];
  const path = relative(root, join(dir, "pack.yaml"));
  return errors.map((detail) => ({ path, rule: "pack-schema", detail }));
}

// Assertions 2 and 3: implements, bindings, and checks entries must all agree with each other.
function checkImplementsBindingsAndChecks(
  root: string,
  dir: string,
  implementsList: string[],
  checks: CheckEntry[],
): Violation[] {
  const violations: Violation[] = [];
  const checkedLaws = new Set(checks.map((entry) => entry.law));
  const manifestPath = relative(root, join(dir, "checks", "manifest.yaml"));

  for (const law of implementsList) {
    const bindingPath = join(dir, "bindings", `${law}.md`);
    if (!existsSync(bindingPath)) {
      violations.push({
        path: relative(root, bindingPath),
        rule: "binding-missing",
        detail: `${law} is implemented but bindings/${law}.md does not exist`,
      });
    }
    if (!checkedLaws.has(law)) {
      violations.push({
        path: manifestPath,
        rule: "checks-entry-missing",
        detail: `${law} is implemented but has no entry in checks/manifest.yaml`,
      });
    }
  }

  const implementsSet = new Set(implementsList);
  for (const entry of checks) {
    if (!implementsSet.has(entry.law)) {
      violations.push({
        path: manifestPath,
        rule: "checks-entry-unlisted",
        detail: `${entry.law} has a checks entry but is not in implements`,
      });
    }
  }

  return violations;
}

// Doctrine law discovery feeds assertions 4 and 6 for every pack that runs validatePack, so one
// law file with malformed frontmatter anywhere in the corpus must not take down every pack's
// validation. Each file is parsed independently: a failure is reported as its own violation and
// that file is skipped, exactly like corpus.ts's checkLawFile does for the same failure mode, and
// every other file still gets processed normally.
async function loadDoctrineLaws(
  root: string,
): Promise<{ laws: DoctrineLaw[]; violations: Violation[] }> {
  const files = (await fg("doctrine/*/laws/*.md", { cwd: root })).sort();
  const laws: DoctrineLaw[] = [];
  const violations: Violation[] = [];
  for (const relPath of files) {
    let parsed: { data: Record<string, unknown>; body: string };
    try {
      parsed = readFrontmatter(join(root, relPath));
    } catch (error) {
      violations.push({
        path: relPath,
        line: 1,
        rule: "pack-parse-error",
        detail: describeParseError(error),
      });
      continue;
    }
    const id = typeof parsed.data.id === "string" ? parsed.data.id : undefined;
    if (!id) continue;
    laws.push({
      id,
      appliesTo: toStringArray(parsed.data.applies_to),
      path: relPath,
      body: parsed.body,
    });
  }
  return { laws, violations };
}

// Assertion 4: every doctrine law in scope must be implemented or declined by this pack.
function checkLawCoverage(
  root: string,
  dir: string,
  doctrineLaws: DoctrineLaw[],
  implementsList: string[],
  declinedLawIds: string[],
): Violation[] {
  const covered = new Set([...implementsList, ...declinedLawIds]);
  const path = relative(root, join(dir, "pack.yaml"));
  const violations: Violation[] = [];
  for (const law of doctrineLaws) {
    const inScope = law.appliesTo.some((tag) => COVERAGE_APPLIES_TO.has(tag));
    if (!inScope || covered.has(law.id)) continue;
    violations.push({
      path,
      rule: "law-coverage",
      detail: `${law.id} is neither implemented nor declined by this pack`,
    });
  }
  return violations;
}

// Assertion 5: every toolchain entry that declares a config file must point at a file that
// actually exists in the pack. The "declined" key is an array of {category, reason} objects with
// no config field, so the Array.isArray guard below skips it along with anything else malformed.
function checkToolchainConfigsExist(root: string, dir: string, toolchain: unknown): Violation[] {
  if (toolchain === null || typeof toolchain !== "object") return [];
  const violations: Violation[] = [];
  for (const [category, entry] of Object.entries(toolchain as Record<string, unknown>)) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const config = (entry as { config?: unknown }).config;
    if (typeof config !== "string") continue;
    const configPath = join(dir, config);
    if (!existsSync(configPath)) {
      violations.push({
        path: relative(root, configPath),
        rule: "toolchain-config-missing",
        detail: `${category} toolchain config ${config} does not exist in the pack`,
      });
    }
  }
  return violations;
}

// Extracts the body text of one "## Heading" section, up to the next "## " heading or end of
// document. Mirrors the heading scan style corpus.ts uses for law files.
function extractSection(body: string, heading: string): string {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.trim().startsWith("## "));
  const section = end === -1 ? rest : rest.slice(0, end);
  return section.join("\n").trim();
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// Assertion 6: a binding should explain how the stack satisfies a law, not restate the law's own
// statement sentence. Whitespace (including line breaks introduced by prose wrapping) is
// normalized on both sides before the substring check, per the resolved contract.
function checkNoStatementRestatement(
  root: string,
  dir: string,
  implementsList: string[],
  doctrineLaws: DoctrineLaw[],
): Violation[] {
  const lawsById = new Map(doctrineLaws.map((law) => [law.id, law]));
  const violations: Violation[] = [];
  for (const lawId of implementsList) {
    const law = lawsById.get(lawId);
    if (!law) continue;
    const statement = normalizeWhitespace(extractSection(law.body, "## Statement"));
    if (statement.length === 0) continue;
    const bindingPath = join(dir, "bindings", `${lawId}.md`);
    if (!existsSync(bindingPath)) continue;
    const { body } = readFrontmatter(bindingPath);
    if (normalizeWhitespace(body).includes(statement)) {
      violations.push({
        path: relative(root, bindingPath),
        rule: "statement-restated",
        detail: `binding restates the ${lawId} statement verbatim instead of explaining how the stack satisfies it`,
      });
    }
  }
  return violations;
}

function extractLinkTarget(rawTarget: string): string {
  const trimmed = rawTarget.trim();
  const whitespaceIndex = trimmed.search(/\s/);
  const withoutTitle = whitespaceIndex === -1 ? trimmed : trimmed.slice(0, whitespaceIndex);
  const hashIndex = withoutTitle.indexOf("#");
  return hashIndex === -1 ? withoutTitle : withoutTitle.slice(0, hashIndex);
}

function isExemptLinkTarget(rawTarget: string): boolean {
  const trimmed = rawTarget.trim();
  if (trimmed.startsWith("#")) return true;
  if (/^https?:\/\//i.test(trimmed)) return true;
  if (/^mailto:/i.test(trimmed)) return true;
  return false;
}

// Assertion 7: the pack must be readable on its own. README.md must exist, and every relative
// markdown link inside it must resolve to a file inside the pack directory rather than escaping
// into the rest of the corpus.
function checkStandaloneReadme(root: string, dir: string): Violation[] {
  const readmePath = join(dir, "README.md");
  if (!existsSync(readmePath)) {
    return [
      {
        path: relative(root, readmePath),
        rule: "missing-readme",
        detail: "pack requires a standalone README.md",
      },
    ];
  }

  const violations: Violation[] = [];
  const lines = readFileSync(readmePath, "utf8").split("\n");
  lines.forEach((lineText, index) => {
    for (const match of lineText.matchAll(LINK_PATTERN)) {
      const rawTarget = match[1];
      if (rawTarget === undefined || isExemptLinkTarget(rawTarget)) continue;
      const target = extractLinkTarget(rawTarget);
      if (target === "") continue;
      const resolved = resolve(dir, target);
      const inside = resolved === dir || resolved.startsWith(dir + sep);
      if (!inside) {
        violations.push({
          path: relative(root, readmePath),
          line: index + 1,
          rule: "standalone-readme",
          detail: `link target "${rawTarget.trim()}" resolves outside the pack`,
        });
      }
    }
  });
  return violations;
}

// validatePack deliberately does not call loadPack: loadPack's job (see Task 14's resolve.ts,
// which needs a Pack or a thrown error) is to throw on a broken pack.yaml or checks manifest, and
// that contract is left alone. validatePack instead calls the same underlying parseYamlObject /
// readChecksManifest primitives itself, each wrapped in its own try/catch, so a parse failure
// becomes a Violation, the Promise<Violation[]> contract never rejects for these causes, and the
// two failure points still get distinct, precisely attributed paths in the report.
export async function validatePack(packDir: string): Promise<Violation[]> {
  const dir = resolve(packDir);
  const root = repoRoot(dir);
  const manifestPath = join(dir, "pack.yaml");

  // A pack.yaml that is missing or fails to parse leaves nothing else meaningful to validate: no
  // name, no implements, no toolchain. Report it alone and stop, the same way corpus.ts's
  // checkLawFile stops after a law file fails to parse rather than validating undefined data.
  let manifest: Record<string, unknown>;
  try {
    manifest = parseYamlObject(manifestPath);
  } catch (error) {
    return [
      {
        path: relative(root, manifestPath),
        line: 1,
        rule: "pack-parse-error",
        detail: describeParseError(error),
      },
    ];
  }

  const violations: Violation[] = [];

  // Unlike pack.yaml, a checks manifest that fails to parse still leaves a fully usable manifest
  // behind (name, implements, declines, toolchain), so degrade to an empty checks list and keep
  // running every other assertion instead of aborting the whole validation.
  let checks: CheckEntry[];
  try {
    checks = readChecksManifest(dir);
  } catch (error) {
    checks = [];
    violations.push({
      path: relative(root, join(dir, "checks", "manifest.yaml")),
      line: 1,
      rule: "pack-parse-error",
      detail: describeParseError(error),
    });
  }

  const implementsList = toStringArray(manifest.implements);
  const declinedLawIds = toDeclinedLawIds(manifest.declines);
  const { laws: doctrineLaws, violations: doctrineViolations } = await loadDoctrineLaws(root);

  violations.push(
    ...checkManifestSchema(root, dir, manifest),
    ...checkImplementsBindingsAndChecks(root, dir, implementsList, checks),
    ...doctrineViolations,
    ...checkLawCoverage(root, dir, doctrineLaws, implementsList, declinedLawIds),
    ...checkToolchainConfigsExist(root, dir, manifest.toolchain),
    ...checkNoStatementRestatement(root, dir, implementsList, doctrineLaws),
    ...checkStandaloneReadme(root, dir),
  );

  return violations;
}
