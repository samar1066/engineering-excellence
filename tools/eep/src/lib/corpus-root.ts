import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot } from "./schema.js";

// A directory is the corpus only when it carries both markers. eep.yaml alone is not enough: a
// consumer repo that has already adopted eep has one of those too, and picking it would hand
// adopt and init the consumer's own checkout as the corpus to read packs from.
function isCorpusDir(dir: string): boolean {
  return existsSync(join(dir, "eep.yaml")) && existsSync(join(dir, "packs"));
}

/**
 * Locates the eep corpus checkout this CLI was installed from, by walking up from this module's
 * own file location rather than from process.cwd().
 *
 * The cwd is the wrong anchor for a default: `eep adopt` and `eep init` are run from inside the
 * consumer project, so a cwd walk finds the consumer, not the corpus, and every later lookup
 * (packs, laws, scaffolds) then fails against a tree that was never meant to answer it. This
 * module's location, by contrast, moves with the CLI: from src/lib/ in a checkout, or from dist/
 * in a build, the corpus root is a few directories up either way.
 *
 * Falls back to repoRoot() when no ancestor carries both markers, which is the case when the CLI
 * is bundled somewhere outside a corpus checkout entirely. An explicit --corpus always wins over
 * both, and remains the answer for anyone pointing the CLI at a corpus it did not ship from.
 */
export function corpusRoot(startFile: string = fileURLToPath(import.meta.url)): string {
  let dir = dirname(startFile);
  while (true) {
    if (isCorpusDir(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return repoRoot();
    dir = parent;
  }
}
