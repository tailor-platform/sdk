import * as fs from "node:fs";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { prompt } from "#/cli/shared/prompt";
import { setupDelete } from "./delete";
import { type CoordinateSetupOptions, setupCoordinate, setupTarget } from "./generate";
import { readLock } from "./lock";

vi.mock("#/cli/shared/prompt", () => ({
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
  });

  const actionOpts = (name: string, dir = "."): Parameters<typeof setupTarget>[0] => ({
    kind: "action",
    workspaceName: name,
    dir,
    force: false,
    outputDir: testDir,
    gitRunner: () => "origin/main",
    loadConfigName: async () => name,
    loadHasStaticWebsites: async () => false,
  });

  const coordinateOpts = (
    overrides: Partial<CoordinateSetupOptions> = {},
  ): CoordinateSetupOptions => ({
    coordinatorName: "main",
    coordinateKind: "branch",
    actions: ["api"],
    branch: "main",
    force: false,
    outputDir: testDir,
    gitRunner: () => "origin/main",
    ...overrides,
  });

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, "pnpm-lock.yaml"), "");
    fs.writeFileSync(
      path.join(testDir, "tailor.config.ts"),
      `import { defineConfig } from "@tailor-platform/sdk";\nexport default defineConfig({ name: "api" });\n`,
    );
    vi.mocked(prompt.confirm).mockReset();
  });

  afterEach(() => fs.rmSync(testDir, { recursive: true, force: true }));

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

  test("prompts for confirmation and aborts when declined", async () => {
    await setupTarget(branchOpts("my-app"));
    const wf = path.join(testDir, ".github/workflows/tailor-my-app.yml");
    vi.mocked(prompt.confirm).mockResolvedValue(false);

    await setupDelete({
      files: [".github/workflows/tailor-my-app.yml"],
      yes: false,
      outputDir: testDir,
    });

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

  test("removes the composite action's now-empty directory", async () => {
    await setupTarget(actionOpts("api"));
    const actionDir = path.join(testDir, ".github/actions/tailor-api");
    expect(fs.existsSync(actionDir)).toBe(true);

    await setupDelete({
      files: [".github/actions/tailor-api/action.yml"],
      yes: true,
      outputDir: testDir,
    });

    expect(fs.existsSync(actionDir)).toBe(false);
  });

  test("errors when the lock is missing", async () => {
    await expect(
      setupDelete({
        files: [".github/workflows/tailor-my-app.yml"],
        yes: true,
        outputDir: testDir,
      }),
    ).rejects.toThrow(/tailor-sdk\.lock is missing or empty/);
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
    ).rejects.toThrow(/not recorded in .github\/tailor-sdk\.lock/);
    expect(fs.existsSync(strayFile)).toBe(true);
  });

  test("never deletes the user-owned tailor-setup action, even if named explicitly", async () => {
    await setupTarget(actionOpts("api"));
    await setupCoordinate(coordinateOpts());
    const setupAction = path.join(testDir, ".github/actions/tailor-setup/action.yml");
    expect(fs.existsSync(setupAction)).toBe(true);

    await expect(
      setupDelete({
        files: [".github/actions/tailor-setup/action.yml"],
        yes: true,
        outputDir: testDir,
      }),
    ).rejects.toThrow(/not recorded in .github\/tailor-sdk\.lock/);
    expect(fs.existsSync(setupAction)).toBe(true);
  });

  test("rejects a path that escapes the repository root", async () => {
    await setupTarget(branchOpts("my-app"));
    await expect(
      setupDelete({ files: ["../outside.yml"], yes: true, outputDir: testDir }),
    ).rejects.toThrow(/inside the repository/);
  });

  test("warns when deleting an action still referenced by a coordinator, but still deletes it", async () => {
    await setupTarget(actionOpts("api"));
    await setupCoordinate(coordinateOpts());
    const warnSpy = vi.spyOn((await import("#/cli/shared/logger")).logger, "warn");

    await setupDelete({
      files: [".github/actions/tailor-api/action.yml"],
      yes: true,
      outputDir: testDir,
    });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Coordinator "main"'));
    expect(fs.existsSync(path.join(testDir, ".github/actions/tailor-api/action.yml"))).toBe(false);
    const lock = readLock(testDir);
    expect(lock?.targets.some((t) => t.kind === "action")).toBe(false);
    expect(lock?.targets.some((t) => t.kind === "coordinate")).toBe(true);
    warnSpy.mockRestore();
  });

  test.each([
    [
      "action then coordinator",
      [".github/actions/tailor-api/action.yml", ".github/workflows/tailor-coordinate-main.yml"],
    ],
    [
      "coordinator then action",
      [".github/workflows/tailor-coordinate-main.yml", ".github/actions/tailor-api/action.yml"],
    ],
  ])(
    "does not warn when the coordinator is deleted together with the action (%s)",
    async (_label, files) => {
      await setupTarget(actionOpts("api"));
      await setupCoordinate(coordinateOpts());
      const warnSpy = vi.spyOn((await import("#/cli/shared/logger")).logger, "warn");

      await setupDelete({ files, yes: true, outputDir: testDir });

      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("Coordinator"));
      expect(readLock(testDir)?.targets).toHaveLength(0);
      warnSpy.mockRestore();
    },
  );
});
