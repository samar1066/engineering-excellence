import { readFileSync } from "node:fs";
import matter from "gray-matter";

export function readFrontmatter(path: string): { data: Record<string, unknown>; body: string } {
  const parsed = matter(readFileSync(path, "utf8"));
  return { data: parsed.data as Record<string, unknown>, body: parsed.content };
}
