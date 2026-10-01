import { runCommand } from "@politty/zod";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { initCommand } from "./init";
import type { SpawnSyncReturns } from "node:child_process";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

vi.mock("#/cli/shared/logger", async (importOriginal) => ({
  ...(await importOriginal()),
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("#/cli/shared/package-json", () => ({
  readPackageJson: vi.fn().mockResolvedValue({ version: "1.2.3" }),
}));

function spawnResult(overrides: Partial<SpawnSyncReturns<string>>): SpawnSyncReturns<string> {
  return {
    pid: 0,
    output: [],
    stdout: "",
    stderr: "",
    status: 0,
    signal: null,
    ...overrides,
  };
}

describe("init command", () => {
  aroundEach(async (runTest) => {
    vi.stubEnv("npm_config_user_agent", "pnpm/10.0.0 npm/? node/v24.0.0");
    await runTest();
    vi.unstubAllEnvs();
  });

  test("runs create-sdk through the detected package manager", async () => {
    const { spawnSync } = await import("node:child_process");
    vi.mocked(spawnSync).mockReturnValue(spawnResult({ status: 0 }));

    const result = await runCommand(initCommand, ["my-app", "--template", "hello"]);

    expect(result.success).toBe(true);
    expect(spawnSync).toHaveBeenCalledWith(
      "pnpm",
      ["create", "@tailor-platform/sdk@1.2.3", "my-app", "--template", "hello"],
      { stdio: "inherit" },
    );
  });

  test("fails when create-sdk exits with a non-zero code", async () => {
    const { spawnSync } = await import("node:child_process");
    vi.mocked(spawnSync).mockReturnValue(spawnResult({ status: 3 }));

    const result = await runCommand(initCommand, ["my-app"]);

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({
      code: "INIT_FAILED",
      message: "pnpm create exited with code 3.",
      context: {
        command: "pnpm",
        args: ["create", "@tailor-platform/sdk@1.2.3", "my-app"],
        exitCode: 3,
      },
    });
  });

  test("fails when create-sdk is terminated by a signal", async () => {
    const { spawnSync } = await import("node:child_process");
    vi.mocked(spawnSync).mockReturnValue(spawnResult({ status: null, signal: "SIGTERM" }));

    const result = await runCommand(initCommand, ["my-app"]);

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({
      code: "INIT_FAILED",
      message: "pnpm create was terminated by SIGTERM.",
      context: { signal: "SIGTERM" },
    });
  });

  test("fails when the package manager cannot be started", async () => {
    const { spawnSync } = await import("node:child_process");
    vi.mocked(spawnSync).mockReturnValue(
      spawnResult({ status: null, error: new Error("spawnSync pnpm ENOENT") }),
    );

    const result = await runCommand(initCommand, ["my-app"]);

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({
      code: "INIT_SPAWN_FAILED",
      message: "Failed to run pnpm: spawnSync pnpm ENOENT",
      context: { command: "pnpm" },
    });
  });
});
