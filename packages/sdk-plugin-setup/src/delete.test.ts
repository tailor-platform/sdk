import * as fs from "node:fs";
import { prompt } from "@tailor-platform/sdk/cli";
import * as path from "pathe";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { setupDelete } from "./delete";
import { setupTarget } from "./generate";
import { readLock } from "./lock";

vi.mock("@tailor-platform/sdk/cli", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tailor-platform/sdk/cli")>()),
  prompt: {
    confirm: vi.fn(),
  },
}));

describe("setupDelete", () => {
  const testDir = path.join(
    "/tmp",
    `setup-delete-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  const branchOpts = (name: string): Parameters<typeof setupTarget>[0] => ({
    kind: "branch",
    workspaceName: name,
    branch: "main",
    erdPreview: false,
    dir: ".",
    force: false,
    outputDir: testDir,
    gitRunner: () => "origin/main",
    loadConfigName: async () => name,
    loadConfigId: async () => undefined,
  });

  aroundEach(async (runTest) => {
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, "pnpm-lock.yaml"), "");
    fs.writeFileSync(
      path.join(testDir, "tailor.config.ts"),
      `import { defineConfig } from "@tailor-platform/sdk";\nexport default defineConfig({ name: "api" });\n`,
    );
    vi.mocked(prompt.confirm).mockReset();
    await runTest();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test("deletes a managed workflow file and its lock entry, skipping the prompt with yes", async () => {
    await setupTarget(branchOpts("my-app"));
    const wf = path.join(testDir, ".github/workflows/tailor-my-app.yml");
    expect(fs.existsSync(wf)).toBe(true);

    await setupDelete({
      files: [".github/workflows/tailor-my-app.yml"],
      yes: true,
      outputDir: testDir,
    });

    expect(fs.existsSync(wf)).toBe(false);
    expect(prompt.confirm).not.toHaveBeenCalled();
    expect(readLock(testDir)?.targets).toHaveLength(0);
  });

  test("keeps the appIds section when a target is deleted", async () => {
    await setupTarget(branchOpts("my-app"));
    const appIds = readLock(testDir)?.appIds;
    expect(appIds?.["tailor.config.ts"]).toBeDefined();

    await setupDelete({
      files: [".github/workflows/tailor-my-app.yml"],
      yes: true,
      outputDir: testDir,
    });

    expect(readLock(testDir)).toMatchObject({ targets: [], appIds });
  });

  test("prompts for confirmation and fails without deleting when declined", async () => {
    await setupTarget(branchOpts("my-app"));
    const wf = path.join(testDir, ".github/workflows/tailor-my-app.yml");
    vi.mocked(prompt.confirm).mockResolvedValue(false);

    await expect(
      setupDelete({
        files: [".github/workflows/tailor-my-app.yml"],
        yes: false,
        outputDir: testDir,
      }),
    ).rejects.toThrow("Delete cancelled. No files were changed.");

    expect(fs.existsSync(wf)).toBe(true);
    expect(readLock(testDir)?.targets).toHaveLength(1);
  });

  test("deletes after confirmation is accepted", async () => {
    await setupTarget(branchOpts("my-app"));
    const wf = path.join(testDir, ".github/workflows/tailor-my-app.yml");
    vi.mocked(prompt.confirm).mockResolvedValue(true);

    await setupDelete({
      files: [".github/workflows/tailor-my-app.yml"],
      yes: false,
      outputDir: testDir,
    });

    expect(fs.existsSync(wf)).toBe(false);
    expect(readLock(testDir)?.targets).toHaveLength(0);
  });

  test("normalizes ./ prefix and accepts multiple files in one call", async () => {
    await setupTarget(branchOpts("app-a"));
    await setupTarget({ ...branchOpts("app-b"), kind: "tag", tagPattern: "v*" });

    await setupDelete({
      files: ["./.github/workflows/tailor-app-a.yml", ".github/workflows/tailor-app-b-tag.yml"],
      yes: true,
      outputDir: testDir,
    });

    expect(fs.existsSync(path.join(testDir, ".github/workflows/tailor-app-a.yml"))).toBe(false);
    expect(fs.existsSync(path.join(testDir, ".github/workflows/tailor-app-b-tag.yml"))).toBe(false);
    expect(readLock(testDir)?.targets).toHaveLength(0);
  });

  test("errors when the lock is missing", async () => {
    await expect(
      setupDelete({
        files: [".github/workflows/tailor-my-app.yml"],
        yes: true,
        outputDir: testDir,
      }),
    ).rejects.toThrow(/tailor\.lock is missing or empty/);
  });

  test("refuses to delete a file that is not recorded in the lock", async () => {
    await setupTarget(branchOpts("my-app"));
    const strayFile = path.join(testDir, ".github/workflows/hand-written.yml");
    fs.writeFileSync(strayFile, "name: hand written\n");

    await expect(
      setupDelete({
        files: [".github/workflows/hand-written.yml"],
        yes: true,
        outputDir: testDir,
      }),
    ).rejects.toThrow(/not recorded in .github\/tailor\.lock/);
    expect(fs.existsSync(strayFile)).toBe(true);
  });

  test("rejects a path that escapes the repository root", async () => {
    await setupTarget(branchOpts("my-app"));
    await expect(
      setupDelete({ files: ["../outside.yml"], yes: true, outputDir: testDir }),
    ).rejects.toThrow(/inside the repository/);
  });
});
