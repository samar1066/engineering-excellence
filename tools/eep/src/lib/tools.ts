import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

/**
 * The AI coding tools eep can generate instructions for, one token each.
 *
 * A selection is a set of these. Each token maps to the file surface(s) it owns:
 *   claude  -> CLAUDE.md at the root and one CLAUDE.md per component directory
 *   agents  -> AGENTS.md at the root and one AGENTS.md per component directory
 *   copilot -> .github/copilot-instructions.md, root only
 *   cursor  -> .cursor/rules/eep.mdc, root only
 * A selection carrying none of these (the "none" choice, or an explicitly empty list) writes no
 * agent instruction files at all: the vendored .eep tree, the gate, and each pack's STACK.md still
 * work without them.
 */
export type ToolToken = "claude" | "agents" | "copilot" | "cursor";

// Canonical order, used for every selection this module returns so a stored eep.yaml and a printed
// summary are stable whatever order the tokens were typed or detected in. agents sits last because
// it is the universal baseline, and reads naturally as the final fallback in a list.
export const TOOL_TOKENS: readonly ToolToken[] = ["claude", "copilot", "cursor", "agents"];

// How each token is named at the interactive prompt. The wording matches the multi select the brief
// specifies, so a reader sees the tool rather than the token.
export const TOOL_LABELS: Record<ToolToken, string> = {
  claude: "Claude Code",
  copilot: "GitHub Copilot",
  cursor: "Cursor",
  agents: "Other AGENTS.md compatible agents",
};

// The choice a user makes to say "generate no agent instruction files". Not a ToolToken: it resolves
// to the empty selection, and it is exclusive, so pairing it with real tokens still means none.
export const NONE_TOKEN = "none";

// The baseline selection when nothing else decides one: AGENTS.md alone, the one instruction file
// every AGENTS.md aware agent reads, so a repository that never answers the question still gets
// cross tool coverage rather than nothing.
export const DEFAULT_TOOLS: readonly ToolToken[] = ["agents"];

function isToolToken(value: string): value is ToolToken {
  return (TOOL_TOKENS as readonly string[]).includes(value);
}

/**
 * Normalizes raw tokens (typed at `--tools`, or read from eep.yaml) into a deduplicated selection in
 * canonical order, plus any tokens that named no tool. Case and surrounding whitespace are ignored.
 *
 * `none` collapses the whole selection to empty, and is dominant: `claude,none` resolves to none, on
 * the principle that the explicit "no files" choice should never be silently overridden by a token
 * beside it. `none` is never itself reported as unknown.
 */
export function parseToolSelection(raw: readonly string[]): {
  tools: ToolToken[];
  unknown: string[];
} {
  const chosen = new Set<ToolToken>();
  const unknown: string[] = [];
  let none = false;
  for (const entry of raw) {
    const token = entry.trim().toLowerCase();
    if (token === "") continue;
    if (token === NONE_TOKEN) {
      none = true;
      continue;
    }
    if (isToolToken(token)) chosen.add(token);
    else unknown.push(entry);
  }
  if (none) return { tools: [], unknown };
  return { tools: TOOL_TOKENS.filter((token) => chosen.has(token)), unknown };
}

/**
 * The tools a repository already shows signs of using, by the files it carries, in canonical order.
 *
 * Used only when there is no explicit selection to honor and no stored one to keep (see
 * resolveToolsNonInteractive). A `.cursor` directory counts whether or not it holds eep's own rule,
 * because a team that keeps their own .cursor rules is a team that uses Cursor.
 */
export function detectTools(targetDir: string): ToolToken[] {
  const found = new Set<ToolToken>();
  if (existsSync(join(targetDir, "CLAUDE.md"))) found.add("claude");
  if (existsSync(join(targetDir, ".github", "copilot-instructions.md"))) found.add("copilot");
  if (existsSync(join(targetDir, ".cursor"))) found.add("cursor");
  if (existsSync(join(targetDir, "AGENTS.md"))) found.add("agents");
  return TOOL_TOKENS.filter((token) => found.has(token));
}

/**
 * The tool selection recorded in an existing eep.yaml, or null when the file has no `tools` key.
 *
 * Present but empty (`tools: []`) is a real selection, the "none" choice, and is returned as `[]`
 * rather than null, because keeping a deliberately empty selection is different from having never
 * chosen one. Anything unreadable or malformed reads as null (no stored selection), so the caller
 * falls through to detection rather than throwing over a file this run is about to rewrite anyway.
 */
export function readEepTools(targetDir: string): ToolToken[] | null {
  const path = join(targetDir, "eep.yaml");
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try {
    parsed = parseYaml(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const tools = (parsed as { tools?: unknown }).tools;
  if (!Array.isArray(tools)) return null;
  const strings = tools.filter((entry): entry is string => typeof entry === "string");
  return parseToolSelection(strings).tools;
}

/**
 * The selection to use when nothing was typed at a prompt and no `--tools` was given: keep an
 * existing eep.yaml selection, else adopt whatever the repository's files reveal, else fall back to
 * the AGENTS.md baseline. A bare directory whose detection finds nothing lands on the baseline too.
 *
 * Never returns empty except when a stored eep.yaml selection was itself explicitly empty (none).
 */
export function resolveToolsNonInteractive(targetDir: string): ToolToken[] {
  const stored = readEepTools(targetDir);
  if (stored !== null) return stored;
  const detected = detectTools(targetDir);
  if (detected.length > 0) return detected;
  return [...DEFAULT_TOOLS];
}

// A selection rendered for a human: the canonical tokens joined, or the word "none" for the empty
// selection, so a printed line never reads "chose:" with nothing after it.
export function formatToolSelection(tools: readonly ToolToken[]): string {
  return tools.length === 0 ? NONE_TOKEN : tools.join(", ");
}
