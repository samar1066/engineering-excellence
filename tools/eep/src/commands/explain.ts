import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { Command } from "commander";
import fg from "fast-glob";
import { readFrontmatter } from "../lib/frontmatter.js";
import { repoRoot } from "../lib/schema.js";

const LAW_GLOB = "doctrine/*/laws";
const BINDING_GLOB = "packs/*/*/bindings";

/**
 * The roots a law body and its bindings are looked up in, most specific first.
 *
 * A consumer repository carries a vendored `.eep/` tree, which is authoritative there because it
 * pins the exact law and pack versions that repository adopted. Inside the corpus checkout itself
 * there is no `.eep/`, so the corpus root is used instead. Both are returned when both exist, so
 * `eep explain` still works from a consumer repository that happens to live inside a corpus
 * checkout, with the vendored copy winning.
 */
function sourceRoots(targetDir: string): string[] {
  const roots: string[] = [];
  const vendored = join(targetDir, ".eep");
  if (existsSync(join(vendored, "doctrine")) || existsSync(join(vendored, "packs"))) {
    roots.push(vendored);
  }
  try {
    const corpus = repoRoot(targetDir);
    if (existsSync(join(corpus, "doctrine")) && !roots.includes(corpus)) roots.push(corpus);
  } catch {
    // Not inside a repository at all: whatever is vendored under targetDir is the only source.
  }
  return roots;
}

function findFiles(roots: string[], pattern: string): string[] {
  const found: string[] = [];
  for (const root of roots) {
    for (const relPath of fg.sync(pattern, { cwd: root, suppressErrors: true }).sort()) {
      found.push(join(root, relPath));
    }
  }
  return found;
}

function knownLawIds(roots: string[]): string[] {
  const ids = new Set<string>();
  for (const path of findFiles(roots, `${LAW_GLOB}/*.md`)) {
    ids.add(basename(path, ".md"));
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
}

// Bindings live at packs/<kind>/<name>/bindings/<id>.md, so the pack name is the grandparent of
// the bindings directory. Read off the path rather than the pack manifest: explain only needs a
// label for the section heading, and a path segment cannot fail to parse.
function packNameFromBindingPath(path: string): string {
  const segments = path.split(/[\\/]/);
  const bindingsIndex = segments.lastIndexOf("bindings");
  return bindingsIndex >= 1 ? (segments[bindingsIndex - 1] ?? "pack") : "pack";
}

/**
 * Returns the full text `eep explain <law>` prints: the law's own body followed by the body of
 * every active pack binding for it, with the frontmatter of each stripped.
 *
 * Throws for an id no source root carries, naming every known id in sorted order so a typo is
 * self correcting.
 */
export function runExplain(lawId: string, targetDir: string): string {
  const roots = sourceRoots(resolve(targetDir));

  const lawPaths = findFiles(roots, `${LAW_GLOB}/${lawId}.md`);
  const lawPath = lawPaths[0];
  if (lawPath === undefined) {
    const known = knownLawIds(roots);
    const listed = known.length === 0 ? "none found" : known.join(", ");
    throw new Error(`eep: unknown law ${lawId}; known laws: ${listed}`);
  }

  const sections = [readFrontmatter(lawPath).body.trim()];

  const seenPacks = new Set<string>();
  for (const bindingPath of findFiles(roots, `${BINDING_GLOB}/${lawId}.md`)) {
    const packName = packNameFromBindingPath(bindingPath);
    if (seenPacks.has(packName)) continue;
    seenPacks.add(packName);
    sections.push(`## Pack binding: ${packName}`, readFrontmatter(bindingPath).body.trim());
  }

  return `${sections.join("\n\n")}\n`;
}

export function register(program: Command): void {
  program
    .command("explain")
    .description("print a law's body and the active pack binding for it")
    .argument("<law>", "law id, for example EEP-SEC-01")
    .action((lawId: string) => {
      try {
        process.stdout.write(runExplain(lawId, process.cwd()));
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
}
