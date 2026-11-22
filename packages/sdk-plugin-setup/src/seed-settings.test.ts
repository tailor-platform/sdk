import { describe, expect, test, vi } from "vitest";
import { defaultLoadSeedSettings } from "./seed-settings";

const loadConfig = vi.hoisted(() => vi.fn());

vi.mock("@tailor-platform/sdk/cli", async (importOriginal) => ({
  ...(await importOriginal()),
  loadConfig,
}));

describe("defaultLoadSeedSettings", () => {
  test("reads a machine user given with its Auth service as configured", async () => {
    loadConfig.mockResolvedValue({
      config: { path: "/project/tailor.config.ts" },
      plugins: [
        {
          id: "@tailor-platform/seed",
          pluginConfig: {
            distPath: "./seed",
            machineUserName: { namespace: "corp-auth", machineUserName: "seeder" },
          },
        },
      ],
    });

    await expect(defaultLoadSeedSettings("/project/tailor.config.ts")).resolves.toMatchObject({
      machineUserName: "corp-auth/seeder",
    });
  });
});
