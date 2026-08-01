export type StyleIssue = {
  line: number;
  rule: "banned-dash" | "zero-ordered-list";
  detail: string;
};

// Banned dash characters are referenced by escape here (not literal glyphs) so this source file
// itself never embeds an em or en dash, even though its job is to detect them in prose.
const EM_DASH = "\u2014";
const EN_DASH = "\u2013";

export function scanMarkdownStyle(text: string): StyleIssue[] {
  const issues: StyleIssue[] = [];
  const lines = text.split("\n");
  let inFence = false;
  lines.forEach((raw, i) => {
    if (/^\s*(```|~~~)/.test(raw)) inFence = !inFence;
    const line = i + 1;
    if (raw.includes(EM_DASH) || raw.includes(EN_DASH)) {
      issues.push({
        line,
        rule: "banned-dash",
        detail: "em or en dash found; use a colon, comma, or new sentence",
      });
    }
    if (!inFence && /^\s*0[.)]\s/.test(raw)) {
      issues.push({ line, rule: "zero-ordered-list", detail: "ordered lists start at 1" });
    }
  });
  return issues;
}
