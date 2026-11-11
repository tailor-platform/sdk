import { runCommand } from "@politty/zod";
import { describe, expect, test, vi } from "vitest";
import { generateCommand } from "#/cli/commands/generate/index";

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  initTelemetry: vi.fn(),
}));

vi.mock("#/cli/commands/generate/service", () => ({ generate: mocks.generate }));
vi.mock("#/cli/telemetry/index", () => ({ initTelemetry: mocks.initTelemetry }));

describe("generateCommand", () => {
  test.each([
    {
      name: "uses the default config path when TAILOR_CONFIG_PATH is unset",
      env: {},
      args: [],
      configPath: "tailor.config.ts",
    },
    {
      name: "reads the config path from TAILOR_CONFIG_PATH",
      env: { TAILOR_CONFIG_PATH: "env/tailor.config.ts" },
      args: [],
      configPath: "env/tailor.config.ts",
    },
    {
      name: "prefers --config over TAILOR_CONFIG_PATH",
      env: { TAILOR_CONFIG_PATH: "env/tailor.config.ts" },
      args: ["--config", "flag/tailor.config.ts"],
      configPath: "flag/tailor.config.ts",
    },
  ])("$name", async ({ env, args, configPath }) => {
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    try {
      await runCommand(generateCommand, args);
    } finally {
      vi.unstubAllEnvs();
    }

    expect(mocks.generate).toHaveBeenCalledWith({ configPath });
  });
});
