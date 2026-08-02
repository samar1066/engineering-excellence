import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import fg from "fast-glob";
import { parse as parseYaml } from "yaml";
import { VERSION } from "../version.js";
import { readFrontmatter } from "./frontmatter.js";
import { type Profile, type ResolvedLaw, resolveLaws } from "./resolve.js";

const PROFILE_BLOCK_TEXT = {
  greenfield:
    "Profile: greenfield. Every law blocks. Scaffold with eep init output patterns; never hand roll what a template covers.",
  evolving:
    "Profile: evolving. New and modified code must comply. Do not refactor untouched code in the same pull request.",
} as const;

// The authority sentence is part of the footer rather than a section of its own: an agent that
// reads eep.yaml and edits it expecting the gate to change would be wrong, and the last paragraph
// of the instructions is where that correction is still being read.
const VERIFY_FOOTER =
  "Before declaring work done run `eep verify`. On failure run `eep explain <LAW-ID>`. " +
  "Configuration authority is .eep/lock.yaml; eep.yaml is a human readable record only.";

function readYamlObject(path: string): Record<string, unknown> {
  const parsed: unknown = parseYaml(readFileSync(path, "utf8"));
  if (parsed === null || typeof parsed !== "object") return {};
  return parsed as Record<string, unknown>;
}

// lock.yaml's packs entries are {name, version} objects (see vendor.ts); only the name is needed
// here, both to drive resolveLaws and to locate each pack's vendored STACK.md.
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

// greenfield and evolving are the only profiles a lock.yaml can carry once resolveLaws has run
// without throwing (it rejects "steady" itself, see generateAgentFiles below), so the throw here
// is unreachable in practice. It exists so this function is total over the Profile type without a
// cast, and, if it is ever reached, it raises the exact message resolveLaws raises for "steady".
function profileBlock(profile: Profile): string {
  if (profile === "greenfield") return PROFILE_BLOCK_TEXT.greenfield;
  if (profile === "evolving") return PROFILE_BLOCK_TEXT.evolving;
  throw new Error("steady enforcement ships in a later release; run greenfield or evolving");
}

// Drops a trailing "---" rule followed by a "*Authored by" line, when both are the last
// non-empty lines of the body, so a document's per-file attribution footer is not repeated once
// per section in the assembled agent instructions.
function stripFooter(body: string): string {
  const lines = body.split("\n");

  const trimTrailingBlankLines = (): void => {
    while (lines.length > 0 && (lines[lines.length - 1] ?? "").trim() === "") {
      lines.pop();
    }
  };

  trimTrailingBlankLines();
  const last = lines[lines.length - 1];
  if (last?.trim().startsWith("*Authored by")) {
    lines.pop();
    trimTrailingBlankLines();
    const rule = lines[lines.length - 1];
    if (rule !== undefined && rule.trim() === "---") {
      lines.pop();
    }
  }
  trimTrailingBlankLines();

  return lines.join("\n");
}

// Frontmatter stripped via readFrontmatter's .body, footer stripped via stripFooter, then trimmed
// of the leading/trailing blank lines both of those leave behind.
function readStrippedBody(path: string): string {
  const { body } = readFrontmatter(path);
  return stripFooter(body).trim();
}

// Packs vendor at .eep/packs/<kind>/<name>/ (kind mirrors the corpus's own packs/<kind>/<name>/
// shape; see vendor.ts), so the kind segment is globbed rather than assumed.
function findStackMdPath(targetDir: string, packName: string): string {
  const matches = fg.sync(`.eep/packs/*/${packName}/STACK.md`, { cwd: targetDir }).sort();
  const first = matches[0];
  if (first === undefined) {
    throw new Error(`eep: STACK.md not found for pack "${packName}" in ${targetDir}/.eep/packs`);
  }
  return join(targetDir, first);
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function severityCell(law: ResolvedLaw): string {
  return law.declined !== null ? "declined" : law.severity;
}

function checkCell(law: ResolvedLaw): string {
  if (law.declined !== null) return escapeTableCell(law.declined);
  if (law.check === null) return "";
  const command =
    law.check.kind === "builtin" ? `builtin: ${law.check.command}` : law.check.command;
  return `\`${escapeTableCell(command)}\``;
}

// One row per resolved entry, so a law two packs both implement appears once per pack with that
// pack's own check command. An agent reading this table has to be able to see that the coverage
// law it is about to satisfy is gated twice, by two different commands, in two different
// directories.
function buildLawTable(laws: ResolvedLaw[]): string {
  const header = "| Law | Pack | Title | Severity | Check |";
  const divider = "| --- | --- | --- | --- | --- |";
  const rows = laws.map(
    (law) =>
      `| ${law.id} | ${escapeTableCell(law.pack)} | ${escapeTableCell(law.title)} | ${severityCell(law)} | ${checkCell(law)} |`,
  );
  return ["## The laws in force", "", header, divider, ...rows].join("\n");
}

/**
 * Builds one agent instructions body from a vendored `.eep/` tree and writes it, byte identical,
 * to both `${targetDir}/AGENTS.md` and `${targetDir}/CLAUDE.md`.
 *
 * The body assembles, in order: the generated-file header, the profile enforcement block, the
 * constitution, each vendored pack's STACK.md golden path, the resolved law table, and a closing
 * reminder to run `eep verify`. Throws when `${targetDir}/.eep/lock.yaml` is absent (no vendored
 * corpus to read), and propagates whatever resolveLaws throws, including its rejection of a
 * "steady" profile.
 */
export function generateAgentFiles(targetDir: string): void {
  const lockPath = join(targetDir, ".eep", "lock.yaml");
  if (!existsSync(lockPath)) {
    throw new Error("eep: no .eep found; run eep adopt first");
  }

  const lock = readYamlObject(lockPath);
  const packNames = toPackNames(lock.packs);
  const profile = toProfile(lock.profile);
  const corpusDir = join(targetDir, ".eep");

  // Resolved first so an invalid profile (or any other resolveLaws failure) surfaces before any
  // output is assembled, using the exact error resolveLaws itself raises.
  const laws = resolveLaws(packNames, profile, corpusDir);

  const sections: string[] = [
    `# Agent instructions (generated by eep ${VERSION}; do not edit, regenerate with eep adopt)`,
    profileBlock(profile),
    readStrippedBody(join(corpusDir, "CONSTITUTION.md")),
    ...packNames.map((name) => readStrippedBody(findStackMdPath(targetDir, name))),
    buildLawTable(laws),
    VERIFY_FOOTER,
  ];

  const body = `${sections.join("\n\n")}\n`;

  writeFileSync(join(targetDir, "AGENTS.md"), body);
  writeFileSync(join(targetDir, "CLAUDE.md"), body);
}
