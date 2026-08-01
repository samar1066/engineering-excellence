import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import type { Command } from "commander";
import fg from "fast-glob";
import { readFrontmatter } from "../lib/frontmatter.js";
import { scanMarkdownStyle } from "../lib/markdown.js";
import { repoRoot, validateAgainst } from "../lib/schema.js";

export type Violation = { path: string; line?: number; rule: string; detail: string };

const EXCLUDED_DIRS = [
  "node_modules",
  "dist",
  ".git",
  "docs/internal",
  ".superpowers",
  ".eep",
  "coverage",
];
const IGNORE_GLOBS = EXCLUDED_DIRS.map((dir) => `**/${dir}/**`);

// Literal entries are checked directly; entries with a "*" are expanded with fast-glob. Every
// level under packs/ is listed, exactly as under doctrine/: packs/ itself, each kind directory
// (packs/stack/), and each concrete pack (packs/stack/python-fastapi/) carries a README today, and
// listing "packs/*" is what makes deleting packs/stack/README.md a reported violation instead of a
// silent gap.
const README_REQUIRED_DIRS = [
  "doctrine",
  "doctrine/*",
  "packs",
  "packs/*",
  "packs/*/*",
  "templates",
  "schemas",
  "profiles",
];

const LAW_HEADINGS = [
  "## Statement",
  "## Rationale",
  "## Pattern",
  "## Antipatterns",
  "## Check contract",
  "## Waiver policy",
];

// Inline markdown links only: [text](target). Reference-style links, HTML anchors, and bare law
// ID mentions in prose (matching EEP-XX-00) are out of scope for this check: prose mentions never
// match this pattern in the first place (they are not wrapped in "[...](...)"), so they need no
// separate carve-out to pass.
const LINK_PATTERN = /\[[^\]]*\]\(([^)]+)\)/g;

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

// gray-matter (via js-yaml) parses unquoted YAML dates such as "created: 2026-08-01" into JS
// Date objects, but the law schema expects a "format: date" string. This walks the whole
// frontmatter object graph (arrays and nested objects included) and rewrites every Date into its
// ISO date string before schema validation sees it.
function normalizeDates(value: unknown): unknown {
  if (value instanceof Date) return toIsoDate(value);
  if (Array.isArray(value)) return value.map((item) => normalizeDates(item));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, val]) => [
        key,
        normalizeDates(val),
      ]),
    );
  }
  return value;
}

function normalizeFrontmatterDates(data: Record<string, unknown>): Record<string, unknown> {
  return normalizeDates(data) as Record<string, unknown>;
}

async function listMarkdownFiles(root: string): Promise<string[]> {
  const files = await fg("**/*.md", { cwd: root, ignore: IGNORE_GLOBS });
  return files.sort();
}

function checkMarkdownStyle(root: string, relPath: string): Violation[] {
  const text = readFileSync(join(root, relPath), "utf8");
  return scanMarkdownStyle(text).map((issue) => ({
    path: relPath,
    line: issue.line,
    rule: issue.rule,
    detail: issue.detail,
  }));
}

// gray-matter/js-yaml errors (YAMLException) carry a multi-line `.message` with a source snippet
// and caret under the offending column. The first line already states the reason plus the line
// and column, so that alone makes a concise, single-line violation detail.
function describeParseError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const [firstLine] = message.split("\n");
  return (firstLine ?? message).trim();
}

function checkLawFile(root: string, relPath: string): Violation[] {
  const fullPath = join(root, relPath);

  // Malformed YAML between the frontmatter delimiters makes gray-matter/js-yaml throw. Without
  // this guard, that throw would propagate out of validateCorpus and abort the whole command
  // before any other file's violations are reported. Catching it here turns one bad file into a
  // single reported violation instead of a stack trace that silences everything else.
  let parsed: { data: Record<string, unknown>; body: string };
  try {
    parsed = readFrontmatter(fullPath);
  } catch (error) {
    return [{ path: relPath, line: 1, rule: "law-parse-error", detail: describeParseError(error) }];
  }

  const violations: Violation[] = [];
  const { data, body } = parsed;
  const normalized = normalizeFrontmatterDates(data);

  const { valid, errors } = validateAgainst("law", normalized);
  if (!valid) {
    for (const error of errors) {
      violations.push({ path: relPath, rule: "law-frontmatter", detail: error });
    }
  }

  const id = typeof normalized.id === "string" ? normalized.id : undefined;
  if (id !== undefined && basename(relPath) !== `${id}.md`) {
    violations.push({
      path: relPath,
      rule: "law-filename",
      detail: `filename must equal ${id}.md`,
    });
  }

  for (const heading of LAW_HEADINGS) {
    if (!body.includes(heading)) {
      violations.push({
        path: relPath,
        rule: "law-headings",
        detail: `missing heading ${heading}`,
      });
    }
  }

  return violations;
}

async function hasNonGitkeepContent(dir: string): Promise<boolean> {
  const entries = await fg("**/*", { cwd: dir, onlyFiles: true, dot: true, ignore: IGNORE_GLOBS });
  return entries.some((entry) => basename(entry) !== ".gitkeep");
}

async function checkReadmeRequired(root: string, relDir: string): Promise<Violation[]> {
  const fullDir = join(root, relDir);
  if (!existsSync(fullDir) || !statSync(fullDir).isDirectory()) return [];
  if (!(await hasNonGitkeepContent(fullDir))) return [];
  if (existsSync(join(fullDir, "README.md"))) return [];
  return [
    {
      path: `${relDir}/README.md`,
      rule: "missing-readme",
      detail: `${relDir} has content and requires a README.md`,
    },
  ];
}

async function resolveReadmeDirs(root: string, pattern: string): Promise<string[]> {
  if (!pattern.includes("*")) return [pattern];
  const dirs = await fg(pattern, { cwd: root, onlyDirectories: true, ignore: IGNORE_GLOBS });
  return dirs.sort();
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

async function checkPackContainment(root: string, relPackDir: string): Promise<Violation[]> {
  const violations: Violation[] = [];
  const packAbsDir = resolve(join(root, relPackDir));
  const files = (await fg("**/*.md", { cwd: packAbsDir, ignore: IGNORE_GLOBS })).sort();

  for (const relFile of files) {
    const relPath = `${relPackDir}/${relFile}`;
    const fullPath = join(packAbsDir, relFile);
    const lines = readFileSync(fullPath, "utf8").split("\n");
    lines.forEach((lineText, index) => {
      for (const match of lineText.matchAll(LINK_PATTERN)) {
        const rawTarget = match[1];
        if (rawTarget === undefined || isExemptLinkTarget(rawTarget)) continue;
        const target = extractLinkTarget(rawTarget);
        if (target === "") continue;
        const resolved = resolve(dirname(fullPath), target);
        const inside = resolved === packAbsDir || resolved.startsWith(packAbsDir + sep);
        if (!inside) {
          violations.push({
            path: relPath,
            line: index + 1,
            rule: "pack-containment",
            detail: `link target "${rawTarget.trim()}" resolves outside pack ${relPackDir}`,
          });
        }
      }
    });
  }

  return violations;
}

export async function validateCorpus(root: string = repoRoot()): Promise<Violation[]> {
  const violations: Violation[] = [];

  const markdownFiles = await listMarkdownFiles(root);
  for (const relPath of markdownFiles) {
    violations.push(...checkMarkdownStyle(root, relPath));
  }

  const lawFiles = (await fg("doctrine/*/laws/*.md", { cwd: root, ignore: IGNORE_GLOBS })).sort();
  for (const relPath of lawFiles) {
    violations.push(...checkLawFile(root, relPath));
  }

  for (const pattern of README_REQUIRED_DIRS) {
    const dirs = await resolveReadmeDirs(root, pattern);
    for (const relDir of dirs) {
      violations.push(...(await checkReadmeRequired(root, relDir)));
    }
  }

  const packDirs = (
    await fg("packs/*/*", { cwd: root, onlyDirectories: true, ignore: IGNORE_GLOBS })
  ).sort();
  for (const relDir of packDirs) {
    violations.push(...(await checkPackContainment(root, relDir)));
  }

  return violations;
}

export function register(program: Command): void {
  const corpus = program.command("corpus").description("corpus maintenance");
  corpus
    .command("validate")
    .description("validate style, frontmatter, READMEs, and pack containment")
    .action(async () => {
      const violations = await validateCorpus();
      for (const v of violations) console.error(`${v.path}:${v.line ?? 1} ${v.rule} ${v.detail}`);
      console.log(`corpus: ${violations.length} violations`);
      if (violations.length > 0) process.exitCode = 1;
    });
}
