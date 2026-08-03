import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import { runInit } from "../src/commands/init.js";
import { repoRoot } from "../src/lib/schema.js";

const corpusDir = repoRoot();

// The wave 1 core aws-fullstack composes, as pack names. react and python-fastapi are the two stack
// components; aws-cdk claims the infra component; containers-k8s and github-actions contribute at the
// repository root. Sorted, because the lock records packs in sorted order.
const CORE = ["aws-cdk", "containers-k8s", "github-actions", "python-fastapi", "react"];
const COMPONENT_DIRS = ["backend", "frontend", "infra"];

const COMPOSE_TIMEOUT = 120_000;

function newTargetDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function lockPackNames(projectDir: string): string[] {
  const parsed: unknown = parseYaml(readFileSync(join(projectDir, ".eep", "lock.yaml"), "utf8"));
  const packs = (parsed as { packs?: { name?: string }[] }).packs ?? [];
  return packs.map((entry) => entry.name ?? "").sort();
}

async function captureLog(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(" "));
  });
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return lines.join("\n");
}

describe("init with a blueprint token", () => {
  it(
    "composes aws-fullstack into the five core component set",
    async () => {
      const targetDir = newTargetDir("eep-blueprint-compose-");
      try {
        await runInit({
          name: "shop",
          targetDir,
          corpusDir,
          tokens: ["aws-fullstack"],
          installOffer: false,
        });

        const projectDir = join(targetDir, "shop");

        // The lock is the proof of what actually composed: exactly the five wave 1 core packs.
        expect(lockPackNames(projectDir)).toEqual(CORE);

        // One component directory per stack and platform pack that claims one; the root packs
        // (containers-k8s, github-actions) claim none.
        for (const dir of COMPONENT_DIRS) {
          expect(existsSync(join(projectDir, dir)), dir).toBe(true);
        }
        expect(existsSync(join(projectDir, "backend", "pyproject.toml"))).toBe(true);
        expect(existsSync(join(projectDir, "infra", "cdk.json"))).toBe(true);

        // github-actions owns the root CI workflow, so a composed aws-fullstack has one.
        expect(existsSync(join(projectDir, ".github", "workflows", "ci.yml"))).toBe(true);

        // containers-k8s and github-actions each ship a dependabot config; the composed root merges
        // them into one file that watches both ecosystems rather than losing one to a collision.
        const dependabot = readFileSync(join(projectDir, ".github", "dependabot.yml"), "utf8");
        expect(dependabot).toContain("package-ecosystem: docker");
        expect(dependabot).toContain("package-ecosystem: github-actions");
      } finally {
        rmSync(targetDir, { recursive: true, force: true });
      }
    },
    COMPOSE_TIMEOUT,
  );

  it(
    "composes the core and reports a slice pack that is not built yet",
    async () => {
      const targetDir = newTargetDir("eep-blueprint-slice-");
      try {
        const output = await captureLog(async () => {
          await runInit({
            name: "shop",
            targetDir,
            corpusDir,
            tokens: ["aws-fullstack"],
            withSlices: ["async"],
            installOffer: false,
          });
        });

        // The slice's pack is on the roadmap, so it is reported and skipped, and the core still
        // composes without it.
        expect(output).toContain("coming soon, skipped: aws-messaging");
        expect(lockPackNames(join(targetDir, "shop"))).toEqual(CORE);
      } finally {
        rmSync(targetDir, { recursive: true, force: true });
      }
    },
    COMPOSE_TIMEOUT,
  );

  it("refuses a blueprint mixed with a framework token, writing nothing", async () => {
    const targetDir = newTargetDir("eep-blueprint-mixed-");
    try {
      await expect(
        runInit({
          name: "shop",
          targetDir,
          corpusDir,
          tokens: ["aws-fullstack", "fastapi"],
          installOffer: false,
        }),
      ).rejects.toThrow(/blueprint aws-fullstack may not be combined with other tokens: fastapi/);

      expect(existsSync(join(targetDir, "shop"))).toBe(false);
    } finally {
      rmSync(targetDir, { recursive: true, force: true });
    }
  });
});
