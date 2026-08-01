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

// Pattern families, not individual patterns: the detail line names the family so a reader knows
// what kind of material was found without the matched text ever being echoed back.
const SECRET_PATTERNS: { family: string; pattern: RegExp }[] = [
  { family: "aws-access-key-id", pattern: /AKIA[0-9A-Z]{16}/ },
  { family: "private-key-header", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  {
    family: "generic-credential-assignment",
    pattern: /(api|secret|token|password)[_-]?key\s*[:=]\s*["'][A-Za-z0-9/+_-]{16,}["']/i,
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
 * direction (scanning more, never less). Patterns containing a slash stay anchored at the target
 * root, matching git's own rule; bare names match at any depth.
 */
function gitignoreGlobs(targetDir: string): string[] {
  const path = join(targetDir, ".gitignore");
  if (!existsSync(path)) return [];

  const globs: string[] = [];
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith("!")) continue;
    const unanchored = line.replace(/^\/+/, "");
    const bare = unanchored.replace(/\/+$/, "");
    if (bare === "") continue;
    const pattern = bare.includes("/") ? bare : `**/${bare}`;
    globs.push(`${pattern}/**`);
    // A trailing slash in .gitignore means "directory only", so no file form is emitted for it.
    if (!unanchored.endsWith("/")) globs.push(pattern);
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

function readTextFile(absPath: string): string | null {
  let size: number;
  try {
    size = statSync(absPath).size;
  } catch {
    return null;
  }
  if (size > MAX_SCAN_BYTES) return null;

  let buffer: Buffer;
  try {
    buffer = readFileSync(absPath);
  } catch {
    return null;
  }
  if (looksBinary(buffer)) return null;
  return buffer.toString("utf8");
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

function summarize(findings: string[]): string {
  const shown = findings.slice(0, MAX_REPORTED_FINDINGS).join("; ");
  const extra = findings.length - MAX_REPORTED_FINDINGS;
  return extra > 0 ? `${shown} (+${extra} more)` : shown;
}

function secretsScan(targetDir: string): BuiltinResult {
  const ignore = [...ALWAYS_IGNORED, ...gitignoreGlobs(targetDir)];
  const files = listFiles(targetDir, "**/*", ignore);

  const findings: string[] = [];
  for (const relPath of files) {
    const text = readTextFile(join(targetDir, relPath));
    if (text === null) continue;
    for (const { family, pattern } of SECRET_PATTERNS) {
      if (pattern.test(text)) findings.push(`${relPath}: ${family}`);
    }
  }

  if (findings.length === 0) {
    return { ok: true, detail: `no credential material in ${files.length} scanned files` };
  }
  return { ok: false, detail: `credential material found: ${summarize(findings)}` };
}

function fileContains(targetDir: string, relPath: string, needle: string): BuiltinResult {
  if (relPath === "" || needle === "") {
    return { ok: false, detail: "file-contains needs a path and a needle" };
  }
  const absPath = join(targetDir, relPath);
  if (!existsSync(absPath)) return { ok: false, detail: `${relPath} does not exist` };
  const text = readTextFile(absPath);
  if (text === null) return { ok: false, detail: `${relPath} could not be read as text` };
  if (!text.includes(needle)) {
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
    const text = readTextFile(join(base, relPath));
    if (text?.includes(needle) === true) {
      return { ok: true, detail: `${join(relDir, relPath)} contains "${needle}"` };
    }
  }
  return { ok: false, detail: `no file under ${relDir} contains "${needle}"` };
}

function docsStyle(targetDir: string, relDir: string, restrictTo?: string[]): BuiltinResult {
  if (relDir === "") return { ok: false, detail: "docs-style needs a directory" };
  const base = join(targetDir, relDir);
  if (!existsSync(base)) return { ok: true, detail: `skipped: no ${relDir} directory` };

  let files = listFiles(base, "**/*.md", DOCS_IGNORED);
  let note = "";
  if (restrictTo !== undefined) {
    const allowed = new Set(restrictTo.map((path) => resolve(targetDir, path)));
    files = files.filter((relPath) => allowed.has(resolve(base, relPath)));
    note = " (changed files only)";
  }

  const findings: string[] = [];
  for (const relPath of files) {
    const text = readTextFile(join(base, relPath));
    if (text === null) continue;
    for (const issue of scanMarkdownStyle(text)) {
      findings.push(`${join(relDir, relPath)}:${issue.line} ${issue.rule}`);
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
  const base = join(targetDir, relDir);
  if (!existsSync(base)) return { ok: true, detail: `skipped: no ${relDir} directory` };

  const files = listFiles(base, "**/*.md", DOCS_IGNORED);
  const findings: string[] = [];
  for (const relPath of files) {
    // Unparseable frontmatter is a finding, not a crash: this runs inside the verify gate, where
    // one malformed document must still be reported as that document's failure.
    let data: Record<string, unknown>;
    try {
      data = readFrontmatter(join(base, relPath)).data;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      findings.push(`${join(relDir, relPath)}: frontmatter could not be parsed: ${reason}`);
      continue;
    }
    const missing = ["title", "authors"].filter((key) => data[key] === undefined);
    if (missing.length > 0) {
      findings.push(`${join(relDir, relPath)}: missing ${missing.join(" and ")}`);
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
