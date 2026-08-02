import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import fg from "fast-glob";
import { readFrontmatter } from "./frontmatter.js";
import { scanMarkdownStyle } from "./markdown.js";

/**
 * One builtin's outcome.
 *
 * `skipped` is a third answer, not a flavour of `ok`. A builtin that had nothing to look at (no
 * docs directory to hold documents to) has proved nothing, and reporting it as a pass put a green
 * row in the gate's output for a check that never ran. Callers that gate on the result read
 * `skipped` first and map it to their own skipped channel (see commands/verify.ts); `ok` stays true
 * alongside it so anything that only asks "did this fail" keeps the same answer.
 */
export type BuiltinResult = { ok: boolean; detail: string; skipped?: true };

// Directories no builtin ever walks, regardless of what .gitignore says. .git is version control's
// own storage, node_modules and .venv are third party trees the consumer did not author, and
// .eep/cache is eep's own scratch space.
const ALWAYS_IGNORED = ["**/.git/**", "**/node_modules/**", "**/.venv/**", "**/.eep/cache/**"];

// Co owned agent configuration surfaces, at any depth: the managed block eep writes into them is
// style clean by construction, and the user content around it is not corpus governed prose. A
// repository that has kept its own CLAUDE.md for years must not have adopting eep turn every em
// dash in it into a blocking gate failure. The same exclusion holds for docs-frontmatter, which
// would otherwise demand a title and an authors list inside an agent configuration file. Both the
// anchored and the nested form are listed because a leading "**/" is not guaranteed to match a path
// with no directory component.
const AGENT_FILE_IGNORED = ["CLAUDE.md", "**/CLAUDE.md", "AGENTS.md", "**/AGENTS.md"];

// The markdown builtins additionally skip the whole vendored .eep tree: those files are copies of
// corpus documents the consumer neither wrote nor can fix, and the corpus validates its own style.
const DOCS_IGNORED = [...ALWAYS_IGNORED, "**/.eep/**", ...AGENT_FILE_IGNORED];

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

/**
 * Builtins whose subject is the repository, never one component of it.
 *
 * A credential is a repository wide fact: scoping the scan to one component would let the same leak
 * pass in the directory next door. Documentation style and frontmatter are repository wide for the
 * same reason, one level up: they are laws about the prose a repository publishes, and a composed
 * repository's root README is nobody's component and would otherwise go unchecked by every pack.
 *
 * These three always run from the repository root, whatever workdir the pack that carries them
 * declares, which also means two packs carrying the same command are asking the identical question
 * and the answer can be computed once (see commands/verify.ts).
 */
const REPO_WIDE_BUILTINS = new Set(["secrets-scan", "docs-style", "docs-frontmatter"]);

// A path argument under .github is repository level by nature: CI configuration lives at the root of
// a repository, one copy for the whole tree, so a workdir must not send a check looking for a
// component local copy that should not exist. Same exemption as the repo wide builtins above, but
// stated on the argument rather than the builtin, because the builtin itself (file-contains-any)
// is perfectly component scoped when pointed anywhere else.
const ROOT_ANCHORED_PREFIX = ".github";

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

/** Whether this builtin command is a fact about the whole repository. See REPO_WIDE_BUILTINS. */
export function isRepoWideBuiltin(command: string): boolean {
  return REPO_WIDE_BUILTINS.has(parseCommand(command).name);
}

function requote(value: string): string {
  return /\s/.test(value) ? `'${value}'` : value;
}

/**
 * Rewrites a builtin's path argument to sit under `workdir`, so the check runs against that
 * component while every path it reports stays relative to the repository root.
 *
 * Rewriting the argument, rather than running the builtin with the component as its base directory,
 * is what makes a failure name `backend/README.md` instead of a bare `README.md` that could mean
 * either component. Returns the command untouched for a repo wide builtin, for a .github path, for
 * an empty workdir, and for a command with no path argument at all.
 */
export function scopeBuiltinToWorkdir(command: string, workdir: string): string {
  if (workdir === "") return command;
  const { name, first, rest } = parseCommand(command);
  if (REPO_WIDE_BUILTINS.has(name)) return command;

  const path = unquote(first);
  if (path === "") return command;
  if (path === ROOT_ANCHORED_PREFIX || path.startsWith(`${ROOT_ANCHORED_PREFIX}/`)) return command;

  // Joined with a literal slash rather than path.join: this value is handed to fast-glob patterns
  // as well as to the filesystem, and glob patterns are always posix separated.
  const scoped = requote(`${workdir}/${path}`);
  return rest === "" ? `${name} ${scoped}` : `${name} ${scoped} ${rest}`;
}

/**
 * Translates .gitignore lines into fast-glob `ignore` patterns.
 *
 * Deliberately partial: blank lines, comments, and negations (`!pattern`) are skipped. Skipping a
 * negation is not the conservative direction it first looks like. A negation exists to carve an
 * exception out of a broader pattern that is still translated into an ignore glob here, so a file
 * git actually tracks because of that negation is left out of the scan. This can therefore under
 * scan negated files, and closing it (by resolving ignores the way git itself does) is tracked for
 * fan out.
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

/**
 * Folds a scope directory into a fast-glob pattern. Patterns are always posix separated, and a
 * lone "." (or an empty string) means the whole target tree.
 *
 * Two traps this deliberately avoids. First, only a lone "." or a leading "./" is stripped: a
 * blanket `^\.\/?` would eat the leading dot of a dot directory, turning `.github` into `github`,
 * which matches nothing and reports a clean pass over zero files. Second, the directory name is
 * escaped, because it arrives as a literal path (that is what the existence guard checked) and
 * must not be reinterpreted as glob syntax: a directory called `docs (old)` or `docs[1]` has to
 * match itself. The suffix is appended after escaping so its own wildcards survive.
 */
function scopedPattern(relDir: string, suffix: string): string {
  const normalized = relDir.replace(/\\/g, "/");
  const withoutPrefix = normalized === "." ? "" : normalized.replace(/^\.\//, "");
  const trimmed = withoutPrefix.replace(/\/+$/, "");
  if (trimmed === "" || trimmed === ".") return suffix;
  return `${fg.escapePath(trimmed)}/${suffix}`;
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
    return { ok: true, skipped: true, detail: `no ${relDir} directory to check` };
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
    return { ok: true, skipped: true, detail: `no ${relDir} directory to check` };
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
