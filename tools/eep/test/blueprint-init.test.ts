import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import { runInit } from "../src/commands/init.js";
import { repoRoot } from "../src/lib/schema.js";

const corpusDir = repoRoot();

// The core aws-fullstack composes, as pack names. react and python-fastapi are the two stack
// components; aws-dynamodb claims the data component; aws-cognito claims the auth component; aws-cdk
// claims the infra component; containers-k8s and github-actions contribute at the repository root.
// Sorted, because the lock records packs in sorted order.
const CORE = [
  "aws-cdk",
  "aws-cognito",
  "aws-dynamodb",
  "containers-k8s",
  "github-actions",
  "python-fastapi",
  "react",
];
const COMPONENT_DIRS = ["auth", "backend", "data", "frontend", "infra"];

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
    "composes aws-fullstack into the seven core component set",
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

        // The lock is the proof of what actually composed: exactly the seven core packs.
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

  it(
    "wires the DynamoDB repository into the backend and the table into the infra stack",
    async () => {
      const targetDir = newTargetDir("eep-blueprint-wiring-");
      try {
        await runInit({
          name: "shop",
          targetDir,
          corpusDir,
          tokens: ["aws-fullstack"],
          installOffer: false,
        });

        const projectDir = join(targetDir, "shop");

        // The backend's composition root now constructs the DynamoDB repository behind the unchanged
        // interface, and the adapter file dropped in beside the in memory one.
        const deps = readFileSync(join(projectDir, "backend", "app", "api", "deps.py"), "utf8");
        expect(deps).toContain(
          "from app.infrastructure.repositories.dynamo_note_repository import DynamoNoteRepository",
        );
        expect(deps).toContain("DynamoNoteRepository()");
        expect(deps).not.toContain("MemoryNoteRepository");
        expect(
          existsSync(
            join(
              projectDir,
              "backend",
              "app",
              "infrastructure",
              "repositories",
              "dynamo_note_repository.py",
            ),
          ),
        ).toBe(true);
        expect(readFileSync(join(projectDir, "backend", "pyproject.toml"), "utf8")).toContain(
          '"aioboto3>=13.0.0",',
        );

        // None of the pack's contract-suite fixture tree leaked into the real backend.
        expect(existsSync(join(projectDir, "backend", "conftest.py"))).toBe(false);
        expect(existsSync(join(projectDir, "backend", "wiring"))).toBe(false);

        // The infra stack instantiates the table, hands its name to the service, and grants the
        // task role access, with the construct copied beside the stack.
        expect(existsSync(join(projectDir, "infra", "lib", "note-table.ts"))).toBe(true);
        const stack = readFileSync(join(projectDir, "infra", "lib", "service-stack.ts"), "utf8");
        expect(stack).toContain('import { NoteTable } from "./note-table";');
        expect(stack).toContain('const notes = new NoteTable(this, "Notes", {');
        expect(stack).toContain("NOTES_TABLE_NAME: notes.table.tableName,");
        expect(stack).toContain(
          "notes.table.grantReadWriteData(this.service.taskDefinition.taskRole);",
        );
        // The owner tag carries the project name the wiring pass substituted.
        expect(stack).toContain('owner: "shop",');

        // The whole point of running the pass before the scaffold commit: the swap is committed, not
        // left as an untracked edit beside a governed repository.
        const status = await execa("git", ["status", "--porcelain"], { cwd: projectDir });
        expect(status.stdout.trim()).toBe("");
      } finally {
        rmSync(targetDir, { recursive: true, force: true });
      }
    },
    COMPOSE_TIMEOUT,
  );
});
