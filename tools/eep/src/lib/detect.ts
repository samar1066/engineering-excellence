import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import fg from "fast-glob";
import { loadPack } from "./pack.js";

type DetectRule = { file?: unknown; contains?: unknown };

function toDetectRules(value: unknown): DetectRule[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is DetectRule => item !== null && typeof item === "object");
}

// A rule matches when its file exists inside targetDir and, if contains is set, the file's
// content includes that substring. A rule without a string file can never be satisfied.
function ruleMatches(targetDir: string, rule: DetectRule): boolean {
  if (typeof rule.file !== "string") return false;
  const filePath = join(targetDir, rule.file);
  if (!existsSync(filePath)) return false;
  if (typeof rule.contains === "string") {
    const content = readFileSync(filePath, "utf8");
    if (!content.includes(rule.contains)) return false;
  }
  return true;
}

// Scans every pack manifest in the corpus and returns the names of packs whose detect rules all
// match targetDir (AND semantics across rules), sorted by pack name.
export function detectPacks(targetDir: string, corpusDir: string): string[] {
  const manifestPaths = fg.sync("packs/*/*/pack.yaml", { cwd: corpusDir }).sort();
  const matches: string[] = [];

  for (const relPath of manifestPaths) {
    const dir = dirname(join(corpusDir, relPath));
    const pack = loadPack(dir);
    const rules = toDetectRules(pack.manifest.detect);
    if (rules.length > 0 && rules.every((rule) => ruleMatches(targetDir, rule))) {
      matches.push(pack.name);
    }
  }

  return matches.sort();
}
