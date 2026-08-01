import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import fg from "fast-glob";
import { readFrontmatter } from "./frontmatter.js";
import { scanMarkdownStyle } from "./markdown.js";

export type BuiltinResult = { ok: boolean; detail: string };

// Directories no builtin ever walks, regardless of what .gitignore says. .git is version control's
// own storage, node_modules and .venv are third party trees the consumer did not author, and
// .eep/cache is eep's own scratch space.
const ALWAYS_IGNORED = ["**/.git/**", "**/node_modules/**", "**/.venv/**", "**/.eep/cache/**"];

// The markdown builtins additionally skip the whole vendored .eep tree: those files are copies of
// corpus documents the consumer neither wrote nor can fix, and the corpus validates its own style.
const DOCS_IGNORED = [...ALWAYS_IGNORED, "**/.eep/**"];

const MAX_SCAN_BYTES = 1024 * 1024;
const BINARY_SNIFF_BYTES = 8192;
const MAX_REPORTED_FINDINGS = 5;

/**
 * Pattern families, not individual patterns: the detail line names the family so a reader knows
 * what kind of material was found without the matched text ever being echoed back.
 *
 * The generic family is deliberately wider than a naive "<something>_key = " rule. The `key`
 * suffix is optional so bare `password`, `secret`, and `token` assignments match; there is no
 * closing quote requirement, so a truncated or line wrapped value still trips it; and the value
 * class carries `.` and `=` so JWTs and base64 padding are covered. It errs toward catching more,
 * because a missed credential is unbounded and irreversible while a false positive costs one
 * waiver conversation.
 */
const SECRET_PATTERNS: { family: string; pattern: RegExp }[] = [
  { family: "aws-access-key-id", pattern: /AKIA[0-9A-Z]{16}/ },
  { family: "private-key-header", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  {
    family: "generic-credential-assignment",
    pattern: /(api|secret|token|password|access)([_-]?key)?\s*[:=]\s*["'][A-Za-z0-9/+_.=-]{16,}/i,
  },
];

type ParsedCommand = { name: string; first: string; rest: string };

function parseCommand(command: string): ParsedCommand {
  const trimmed = command.trim();
  const firstBreak = trimmed.search(/\s/);
  if (firstBreak === -1) return { name: trimmed, first: "", rest: "" };
  const name = trimmed.slice(0, firstBreak);
  const tail = trimmed.slice(firstBreak).trim();
  const secondBreak = tail.search(/\s/);
  if (secondBreak === -1) return { name, first: tail, rest: "" };
  return { name, first: tail.slice(0, secondBreak), rest: tail.slice(secondBreak).trim() };
}

// Checks manifests quote multi word needles ("file-contains-any .github/workflows 'eep verify'")
// so the argument reads as one unit. One matched pair of surrounding quotes is therefore removed:
// a needle that genuinely starts and ends with the same quote character must be written with the
// quotes doubled up.
function unquote(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' || first === "'") && last === first) return value.slice(1, -1);
  return value;
}

/**
 * Translates .gitignore lines into fast-glob `ignore` patterns.
 *
 * Deliberately partial: blank lines, comments, and negations (`!pattern`) are skipped, since a
 * negation can only widen the scanned set and skipping it keeps this conservative in the safe
 * direction (scanning more, never less).
 *
 * Anchoring follows git's own rule: a pattern carrying a slash anywhere other than at its end is
 * anchored to the directory the .gitignore sits in, and a leading slash counts. So `/dist` ignores
 * only the root `dist`, while `dist/` ignores a `dist` at any depth. The anchoring test therefore
 * runs before the leading slash is stripped, not after.
 */
function gitignoreGlobs(targetDir: string): string[] {
  const path = join(targetDir, ".gitignore");
  if (!existsSync(path)) return [];

  const globs: string[] = [];
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith("!")) continue;
    const directoryOnly = line.endsWith("/");
    const withoutTrailing = line.replace(/\/+$/, "");
    const anchored = withoutTrailing.includes("/");
    const bare = withoutTrailing.replace(/^\/+/, "");
    if (bare === "") continue;
    const pattern = anchored ? bare : `**/${bare}`;
    globs.push(`${pattern}/**`);
    // A trailing slash in .gitignore means "directory only", so no file form is emitted for it.
    if (!directoryOnly) globs.push(pattern);
  }
  return globs;
}

function looksBinary(buffer: Buffer): boolean {
  const end = Math.min(buffer.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < end; i += 1) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

// A file is either read as text or skipped for a stated reason. The reason is carried rather than
// collapsed to null so a check can report honestly what it did not look at.
type FileRead = { text: string; skipped: null } | { text: null; skipped: string };

function readTextFile(absPath: string): FileRead {
  let size: number;
  try {
    size = statSync(absPath).size;
  } catch {
    return { text: null, skipped: "unreadable" };
  }
  if (size > MAX_SCAN_BYTES) return { text: null, skipped: "over 1 MiB" };

  let buffer: Buffer;
  try {
    buffer = readFileSync(absPath);
  } catch {
    return { text: null, skipped: "unreadable" };
  }
  if (looksBinary(buffer)) return { text: null, skipped: "binary" };
  return { text: buffer.toString("utf8"), skipped: null };
}

function listFiles(dir: string, pattern: string, ignore: string[]): string[] {
  if (!existsSync(dir)) return [];
  return fg
    .sync(pattern, {
      cwd: dir,
      dot: true,
      onlyFiles: true,
      followSymbolicLinks: false,
      suppressErrors: true,
      ignore,
    })
    .sort();
}

// fast-glob patterns are always posix separated. "." and "" both mean the whole target tree.
function scopedPattern(relDir: string, suffix: string): string {
  const normalized = relDir
    .replace(/\\/g, "/")
    .replace(/^\.\/?/, "")
    .replace(/\/+$/, "");
  return normalized === "" ? suffix : `${normalized}/${suffix}`;
}

function summarize(findings: string[]): string {
  const shown = findings.slice(0, MAX_REPORTED_FINDINGS).join("; ");
  const extra = findings.length - MAX_REPORTED_FINDINGS;
  return extra > 0 ? `${shown} (+${extra} more)` : shown;
}

// The pass detail reports what was actually read, not what was listed. A scan that silently
// skipped a binary blob or a 10 MiB file while claiming to have scanned it would be a gate lying
// about its own coverage, so skipped files are counted and the first few are named.
function secretsScan(targetDir: string): BuiltinResult {
  const ignore = [...ALWAYS_IGNORED, ...gitignoreGlobs(targetDir)];
  const files = listFiles(targetDir, "**/*", ignore);

  const findings: string[] = [];
  const skipped: string[] = [];
  let scanned = 0;

  for (const relPath of files) {
    const read = readTextFile(join(targetDir, relPath));
    if (read.text === null) {
      skipped.push(`${relPath} (${read.skipped})`);
      continue;
    }
    scanned += 1;
    for (const { family, pattern } of SECRET_PATTERNS) {
      if (pattern.test(read.text)) findings.push(`${relPath}: ${family}`);
    }
  }

  const note = skipped.length === 0 ? "" : `; ${skipped.length} not read: ${summarize(skipped)}`;
  if (findings.length === 0) {
    return { ok: true, detail: `no credential material in ${scanned} scanned files${note}` };
  }
  return { ok: false, detail: `credential material found: ${summarize(findings)}${note}` };
}

function fileContains(targetDir: string, relPath: string, needle: string): BuiltinResult {
  if (relPath === "" || needle === "") {
    return { ok: false, detail: "file-contains needs a path and a needle" };
  }
  const absPath = join(targetDir, relPath);
  if (!existsSync(absPath)) return { ok: false, detail: `${relPath} does not exist` };
  const read = readTextFile(absPath);
  if (read.text === null) {
    return { ok: false, detail: `${relPath} could not be read as text (${read.skipped})` };
  }
  if (!read.text.includes(needle)) {
    return { ok: false, detail: `${relPath} does not contain "${needle}"` };
  }
  return { ok: true, detail: `${relPath} contains "${needle}"` };
}

function fileContainsAny(targetDir: string, relDir: string, needle: string): BuiltinResult {
  if (relDir === "" || needle === "") {
    return { ok: false, detail: "file-contains-any needs a directory and a needle" };
  }
  const base = join(targetDir, relDir);
  if (!existsSync(base)) return { ok: false, detail: `${relDir} does not exist` };

  const files = listFiles(base, "**/*", ALWAYS_IGNORED);
  for (const relPath of files) {
    const read = readTextFile(join(base, relPath));
    if (read.text?.includes(needle) === true) {
      return { ok: true, detail: `${join(relDir, relPath)} contains "${needle}"` };
    }
  }
  return { ok: false, detail: `no file under ${relDir} contains "${needle}"` };
}

/**
 * Lists the markdown files under `relDir`, as paths relative to the target root.
 *
 * The glob is always rooted at targetDir with `relDir` folded into the pattern, never run with
 * targetDir/relDir as its cwd. Otherwise .gitignore patterns, which git anchors to the repository
 * root, would be matched against subdirectory relative paths and silently miss.
 */
function listMarkdown(targetDir: string, relDir: string): string[] {
  const ignore = [...DOCS_IGNORED, ...gitignoreGlobs(targetDir)];
  return listFiles(targetDir, scopedPattern(relDir, "**/*.md"), ignore);
}

function docsStyle(targetDir: string, relDir: string, restrictTo?: string[]): BuiltinResult {
  if (relDir === "") return { ok: false, detail: "docs-style needs a directory" };
  if (!existsSync(join(targetDir, relDir))) {
    return { ok: true, detail: `skipped: no ${relDir} directory` };
  }

  let files = listMarkdown(targetDir, relDir);
  let note = "";
  if (restrictTo !== undefined) {
    const allowed = new Set(restrictTo.map((path) => resolve(targetDir, path)));
    files = files.filter((relPath) => allowed.has(resolve(targetDir, relPath)));
    note = " (changed files only)";
  }

  const findings: string[] = [];
  for (const relPath of files) {
    const read = readTextFile(join(targetDir, relPath));
    if (read.text === null) continue;
    for (const issue of scanMarkdownStyle(read.text)) {
      findings.push(`${relPath}:${issue.line} ${issue.rule}`);
    }
  }

  if (findings.length === 0) {
    return { ok: true, detail: `no style issues in ${files.length} markdown files${note}` };
  }
  return { ok: false, detail: `style issues${note}: ${summarize(findings)}` };
}

// Presence only: the law schema governs the corpus's own documents, while a consumer's governed
// docs are held to the two keys that make a document attributable, a title and its authors.
function docsFrontmatter(targetDir: string, relDir: string): BuiltinResult {
  if (relDir === "") return { ok: false, detail: "docs-frontmatter needs a directory" };
  if (!existsSync(join(targetDir, relDir))) {
    return { ok: true, detail: `skipped: no ${relDir} directory` };
  }

  const files = listMarkdown(targetDir, relDir);
  const findings: string[] = [];
  for (const relPath of files) {
    // Unparseable frontmatter is a finding, not a crash: this runs inside the verify gate, where
    // one malformed document must still be reported as that document's failure.
    let data: Record<string, unknown>;
    try {
      data = readFrontmatter(join(targetDir, relPath)).data;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      findings.push(`${relPath}: frontmatter could not be parsed: ${reason}`);
      continue;
    }
    const missing = ["title", "authors"].filter((key) => data[key] === undefined);
    if (missing.length > 0) {
      findings.push(`${relPath}: missing ${missing.join(" and ")}`);
    }
  }

  if (findings.length === 0) {
    return { ok: true, detail: `frontmatter complete in ${files.length} markdown files` };
  }
  return { ok: false, detail: `frontmatter incomplete: ${summarize(findings)}` };
}

/**
 * Runs one builtin check by its space separated command string, the same string a pack's
 * checks/manifest.yaml carries for `kind: builtin` entries. The first token names the builtin.
 *
 * `restrictTo` narrows `docs-style` to a caller supplied list of paths (relative to targetDir or
 * absolute), which is how `eep verify --changed` limits the markdown sweep to files that differ
 * from HEAD. Every other builtin ignores it: they are either cheap or repo wide by nature.
 */
export function runBuiltin(
  command: string,
  targetDir: string,
  restrictTo?: string[],
): BuiltinResult {
  const { name, first, rest } = parseCommand(command);
  const dir = resolve(targetDir);

  switch (name) {
    case "secrets-scan":
      return secretsScan(dir);
    case "file-contains":
      return fileContains(dir, unquote(first), unquote(rest));
    case "file-contains-any":
      return fileContainsAny(dir, unquote(first), unquote(rest));
    case "docs-style":
      return docsStyle(dir, unquote(first), restrictTo);
    case "docs-frontmatter":
      return docsFrontmatter(dir, unquote(first));
    default:
      return { ok: false, detail: `unknown builtin ${name}` };
  }
}
