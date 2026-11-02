import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { runCommand } from "@politty/zod";
import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { deployCommand } from "#/cli/commands/deploy/index";
import { commonArgs } from "#/cli/shared/args";
import { logger } from "#/cli/shared/logger";

const mocks = vi.hoisted(() => ({
  assertWritable: vi.fn(),
  deployFromCLI: vi.fn(),
  initTelemetry: vi.fn(),
}));

vi.mock("#/cli/commands/deploy/deploy", () => ({ deployFromCLI: mocks.deployFromCLI }));
vi.mock("#/cli/shared/readonly-guard", () => ({ assertWritable: mocks.assertWritable }));
vi.mock("#/cli/telemetry/index", () => ({ initTelemetry: mocks.initTelemetry }));

describe("deployCommand", () => {
  test.each([
    {
      name: "organization and folder",
      args: [],
      organizationId: "11111111-1111-4111-8111-111111111111",
    },
    {
      name: "organization overridden by a flag",
      args: ["--organization-id", "33333333-3333-4333-8333-333333333333"],
      organizationId: "33333333-3333-4333-8333-333333333333",
    },
  ])("forwards $name loaded from an env file", async ({ args, organizationId }) => {
    const dir = fs.mkdtempSync(path.join(tmpdir(), "tailor-deploy-location-"));
    const envFile = path.join(dir, ".env");
    vi.stubEnv("TAILOR_PLATFORM_ORGANIZATION_ID", undefined);
    vi.stubEnv("TAILOR_PLATFORM_FOLDER_ID", undefined);
    fs.writeFileSync(
      envFile,
      "TAILOR_PLATFORM_ORGANIZATION_ID=11111111-1111-4111-8111-111111111111\nTAILOR_PLATFORM_FOLDER_ID=22222222-2222-4222-8222-222222222222\n",
    );
    try {
      const result = await runCommand(
        deployCommand,
        ["--create-workspace", "--env-file", envFile, ...args],
        {
          // strip unknown keys
          globalArgs: z.object(commonArgs),
        },
      );

      expect(result.success).toBe(true);
      expect(mocks.deployFromCLI).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId,
          folderId: "22222222-2222-4222-8222-222222222222",
        }),
        expect.any(Object),
      );
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(dir, { recursive: true, force: true });
    }
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

  test.each([
    {
      name: "reads comma-separated config paths from TAILOR_CONFIG_PATH",
      env: { TAILOR_CONFIG_PATH: "a/tailor.config.ts,b/tailor.config.ts" },
      args: [],
      configPath: "a/tailor.config.ts,b/tailor.config.ts",
      warnings: [],
    },
    {
      name: "prefers --config over both config path variables",
      env: {
        TAILOR_CONFIG_PATH: "new/tailor.config.ts",
        TAILOR_PLATFORM_SDK_CONFIG_PATH: "old/tailor.config.ts",
      },
      args: ["--config", "flag/tailor.config.ts"],
      configPath: "flag/tailor.config.ts",
      warnings: [],
    },
    {
      name: "uses the default config path when the variables are empty",
      env: { TAILOR_CONFIG_PATH: "", TAILOR_PLATFORM_SDK_CONFIG_PATH: "" },
      args: [],
      configPath: "tailor.config.ts",
      warnings: [],
    },
  ])("$name", async ({ env, args, configPath, warnings }) => {
    using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    try {
      await runCommand(deployCommand, args);

      expect(mocks.deployFromCLI).toHaveBeenCalledWith(
        expect.objectContaining({ configPath }),
        expect.any(Object),
      );
      expect(warnSpy.mock.calls).toEqual(warnings);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test.each([
    {
      name: "TAILOR_CONFIG_PATH",
      variable: "TAILOR_CONFIG_PATH",
      warnings: [],
    },
    {
      name: "the deprecated TAILOR_PLATFORM_SDK_CONFIG_PATH",
      variable: "TAILOR_PLATFORM_SDK_CONFIG_PATH",
      warnings: [
        ["TAILOR_PLATFORM_SDK_CONFIG_PATH is deprecated. Please use TAILOR_CONFIG_PATH instead."],
      ],
    },
  ])("reads $name loaded from an env file", async ({ variable, warnings }) => {
    using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const dir = fs.mkdtempSync(path.join(tmpdir(), "tailor-deploy-config-"));
    const envFile = path.join(dir, ".env");
    vi.stubEnv("TAILOR_CONFIG_PATH", undefined);
    vi.stubEnv("TAILOR_PLATFORM_SDK_CONFIG_PATH", undefined);
    fs.writeFileSync(envFile, `${variable}=env-file/tailor.config.ts\n`);
    try {
      await runCommand(deployCommand, ["--env-file", envFile], {
        // strip unknown keys
        globalArgs: z.object(commonArgs),
      });

      expect(mocks.deployFromCLI).toHaveBeenCalledWith(
        expect.objectContaining({ configPath: "env-file/tailor.config.ts" }),
        expect.any(Object),
      );
      expect(warnSpy.mock.calls).toEqual(warnings);
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(dir, { recursive: true, force: true });
    }
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
      // strip unknown keys
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
