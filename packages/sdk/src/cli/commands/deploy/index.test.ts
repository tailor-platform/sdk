import { runCommand } from "politty";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { deployCommand } from "#/cli/commands/deploy/index";
import { commonArgs } from "#/cli/shared/args";

const mocks = vi.hoisted(() => ({
  assertWritable: vi.fn(),
  deployFromCLI: vi.fn(),
  initTelemetry: vi.fn(),
}));

vi.mock("#/cli/commands/deploy/deploy", () => ({ deployFromCLI: mocks.deployFromCLI }));
vi.mock("#/cli/shared/readonly-guard", () => ({ assertWritable: mocks.assertWritable }));
vi.mock("#/cli/telemetry/index", () => ({ initTelemetry: mocks.initTelemetry }));

describe("deployCommand", () => {
  aroundEach(async (runTest) => {
    vi.clearAllMocks();
    await runTest();
  });

  test("exposes 'apply' as an alias", () => {
    expect(deployCommand.aliases).toContain("apply");
  });

  test("forwards workspace creation options", async () => {
    await runCommand(deployCommand, [
      "--create-workspace",
      "--workspace-name",
      "example-workspace",
      "--workspace-region",
      "us-west",
      "--organization-id",
      "11111111-1111-4111-8111-111111111111",
      "--folder-id",
      "22222222-2222-4222-8222-222222222222",
    ]);

    expect(mocks.deployFromCLI).toHaveBeenCalledWith(
      expect.objectContaining({
        createWorkspace: true,
        workspaceName: "example-workspace",
        workspaceRegion: "us-west",
        organizationId: "11111111-1111-4111-8111-111111111111",
        folderId: "22222222-2222-4222-8222-222222222222",
      }),
      expect.any(Object),
    );
  });

  test("does not treat --yes as workspace creation consent", async () => {
    await runCommand(deployCommand, ["--yes"]);

    expect(mocks.deployFromCLI).toHaveBeenCalledWith(
      expect.objectContaining({ yes: true, createWorkspace: undefined }),
      expect.any(Object),
    );
  });

  test("forwards global options needed to reproduce deploy", async () => {
    await runCommand(deployCommand, ["--env-file-if-exists", ".env.local", "--verbose", "--json"], {
      globalArgs: z.object(commonArgs),
    });

    expect(mocks.deployFromCLI).toHaveBeenCalledWith(
      expect.not.objectContaining({
        envFile: undefined,
        envFileIfExists: ".env.local",
        verbose: true,
        json: true,
      }),
      {
        envFile: undefined,
        envFileIfExists: ".env.local",
        verbose: true,
        json: true,
      },
    );
  });
});
