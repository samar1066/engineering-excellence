import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot } from "./schema.js";

// The directory name scripts/bundle-corpus.mjs writes the published corpus copy into, as a sibling
// of dist/ inside the package.
const BUNDLED_DIR_NAME = "corpus";

// A directory is the corpus only when it carries both markers. eep.yaml alone is not enough: a
// consumer repo that has already adopted eep has one of those too, and picking it would hand
// adopt and init the consumer's own checkout as the corpus to read packs from.
function isCorpusDir(dir: string): boolean {
  return existsSync(join(dir, "eep.yaml")) && existsSync(join(dir, "packs"));
}

// Walks up from dir looking for a corpus checkout, returning null rather than a fallback so the
// caller decides what to try next.
function walkUpForCorpus(dir: string): string | null {
  let current = dir;
  while (true) {
    if (isCorpusDir(current)) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * The corpus bundled inside an installed npm package, or null when there is not one.
 *
 * Anchored on the module directory (dist/ at runtime) and looking one level up, which is where
 * `npm pack` puts it: node_modules/eep-cli/dist/index.js beside node_modules/eep-cli/corpus/.
 *
 * The marker pair is looser than isCorpusDir's on purpose. packs/ is required either way, but the
 * second marker may be eep.yaml or CONSTITUTION.md: the walk up needs eep.yaml specifically to
 * avoid mistaking a consumer's adopted repo for a corpus, while this path is already inside the
 * package's own directory, where no consumer file can be, so the constitution is evidence enough
 * that the bundle is complete rather than a stray directory that happens to be called corpus.
 */
export function bundledCorpusDir(moduleDir: string): string | null {
  const dir = resolve(moduleDir, "..", BUNDLED_DIR_NAME);
  if (!existsSync(join(dir, "packs"))) return null;
  const hasSecondMarker =
    existsSync(join(dir, "eep.yaml")) || existsSync(join(dir, "CONSTITUTION.md"));
  return hasSecondMarker ? dir : null;
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
 * When no ancestor carries both markers, the corpus bundled inside the package answers next (see
 * bundledCorpusDir): that is the npm install case, where there is no checkout above the CLI at
 * all, only node_modules/eep-cli/corpus/ shipped in the tarball beside dist/. Only when neither
 * exists does this fall back to repoRoot(), which reads the cwd. An explicit --corpus always wins
 * over all three, and remains the answer for anyone pointing the CLI at a corpus it did not ship
 * from.
 */
export function corpusRoot(startFile: string = fileURLToPath(import.meta.url)): string {
  const moduleDir = dirname(startFile);
  return walkUpForCorpus(moduleDir) ?? bundledCorpusDir(moduleDir) ?? repoRoot();
}
