import { describe, expect, test } from "vitest";
import { seedPlugin } from "./index";
import type { TailorDBReadyContext } from "#/plugin/types";

describe("seedPlugin", () => {
  test("generates an exec script that bundles relative to the Tailor config directory", async () => {
    const distPath = "/workspace/generated/seed";
    const configPath = "/workspace/config/tailor.config.ts";
    const plugin = seedPlugin({ distPath });
    const context: TailorDBReadyContext<{ distPath: string }> = {
      tailordb: [],
      auth: undefined,
      baseDir: "/workspace",
      configPath,
      pluginConfig: { distPath },
    };

    const result = await plugin.onTailorDBReady!(context);
    const execScript = result.files.find((file) => file.path.endsWith("/exec.mjs"));

    expect(execScript?.content).toContain(
      "bundleSeedScript(namespace, typesWithData, dirname(configPath))",
    );
  });
});
