import { aroundEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveDeployWorkspace: vi.fn(),
}));

vi.mock("./workspace", () => ({
  resolveDeployWorkspace: mocks.resolveDeployWorkspace,
}));

import { deploy, deployFromCLI } from "./deploy";

describe("deploy workspace resolution", () => {
  aroundEach(async (runTest) => {
    vi.clearAllMocks();
    await runTest();
  });

  test("validates the config before resolving or creating a workspace", async () => {
    await expect(deploy({ configPath: "configuration-that-does-not-exist.ts" })).rejects.toThrow(
      "Configuration file not found",
    );
    expect(mocks.resolveDeployWorkspace).not.toHaveBeenCalled();
  });

  test("resolves the workspace after config preflight and before the expensive build", async () => {
    const workspaceError = new Error("workspace resolution stopped deploy");
    mocks.resolveDeployWorkspace.mockRejectedValue(workspaceError);
    const configPath = "src/cli/commands/deploy/__test_fixtures__/tailor.config.ts";

    await expect(deploy({ configPath, dryRun: true, noValidate: true })).rejects.toBe(
      workspaceError,
    );
    expect(mocks.resolveDeployWorkspace).toHaveBeenCalledOnce();
    expect(mocks.resolveDeployWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        dryRun: true,
        contextTargets: [
          {
            applicationId: expect.any(String),
            configPath: expect.stringContaining("__test_fixtures__/tailor.config.ts"),
          },
        ],
        deployArgs: [
          "deploy",
          "--config",
          expect.stringContaining("tailor.config.ts"),
          "--dry-run",
          "--no-validate",
        ],
      }),
    );
  });

  test("preserves global environment and output options in the suggested retry", async () => {
    const workspaceError = new Error("workspace resolution stopped deploy");
    mocks.resolveDeployWorkspace.mockRejectedValue(workspaceError);
    const configPath = "src/cli/commands/deploy/__test_fixtures__/tailor.config.ts";

    await expect(
      deployFromCLI(
        { configPath, profile: "staging" },
        {
          envFile: ".env.workspace",
          envFileIfExists: ".env.local",
          verbose: true,
          json: true,
        },
      ),
    ).rejects.toBe(workspaceError);
    expect(mocks.resolveDeployWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        deployArgs: [
          "deploy",
          "--config",
          expect.stringContaining("tailor.config.ts"),
          "--env-file",
          expect.stringMatching(/\/\.env\.workspace$/),
          "--env-file-if-exists",
          expect.stringMatching(/\/\.env\.local$/),
          "--profile",
          "staging",
          "--verbose",
          "--json",
        ],
        workspaceCommandArgs: [
          "--env-file",
          expect.stringMatching(/\/\.env\.workspace$/),
          "--env-file-if-exists",
          expect.stringMatching(/\/\.env\.local$/),
          "--profile",
          "staging",
          "--verbose",
        ],
        workspaceCommandJson: true,
      }),
    );
  });

  test("evaluates a valid config only once before workspace-scoped work", async () => {
    mocks.resolveDeployWorkspace.mockResolvedValue({
      client: {},
      workspaceId: "11111111-1111-4111-8111-111111111111",
    });

    try {
      await expect(
        deploy({
          configPath: "src/cli/commands/deploy/__test_fixtures__/single-evaluation.config.ts",
          dryRun: true,
        }),
      ).rejects.not.toThrow("Config evaluated more than once");
    } finally {
      delete (globalThis as Record<string, unknown>).__tailorSingleEvaluationConfigCount;
    }
  });

  test("does not require a workspace for build-only mode", async () => {
    await expect(
      deploy({ configPath: "configuration-that-does-not-exist.ts", buildOnly: true }),
    ).rejects.not.toBeUndefined();
    expect(mocks.resolveDeployWorkspace).not.toHaveBeenCalled();
  });
});
