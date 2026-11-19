import * as fs from "node:fs";
import * as path from "pathe";
import { describe, expect, test, vi } from "vitest";
import { generateCommand } from "#/cli/commands/generate/index";
import { runCliCommand } from "#/cli/shared/test-helpers/run-cli-command";
import { tempCwd } from "#/cli/shared/test-helpers/temp-cwd";

const CONFIG_SOURCE = `export default { name: "app" };\n`;

describe("generate config discovery", () => {
  test.each([
    {
      name: "uses the parent directory's config when the current directory has none",
      configs: ["tailor.config.ts"],
      args: [],
      env: {},
      used: "tailor.config.ts",
    },
    {
      name: "uses the parent directory's config when TAILOR_CONFIG_PATH is empty",
      configs: ["tailor.config.ts"],
      args: [],
      env: { TAILOR_CONFIG_PATH: "" },
      used: "tailor.config.ts",
    },
    {
      name: "uses the parent directory's config when --config is empty",
      configs: ["tailor.config.ts"],
      args: ["--config", ""],
      env: {},
      used: "tailor.config.ts",
    },
    {
      name: "prefers the current directory's config over the parent's",
      configs: ["tailor.config.ts", "sub/tailor.config.ts"],
      args: [],
      env: {},
      used: "sub/tailor.config.ts",
    },
    {
      name: "uses --config over the current directory's config",
      configs: ["tailor.config.ts", "sub/tailor.config.ts"],
      args: ["--config", "../tailor.config.ts"],
      env: {},
      used: "tailor.config.ts",
    },
    {
      name: "uses TAILOR_CONFIG_PATH over the current directory's config",
      configs: ["tailor.config.ts", "sub/tailor.config.ts"],
      args: [],
      env: { TAILOR_CONFIG_PATH: "../tailor.config.ts" },
      used: "tailor.config.ts",
    },
  ])("$name", async ({ configs, args, env, used }) => {
    using tmp = tempCwd("tailor-config-discovery-");
    fs.mkdirSync(path.join(tmp.dir, "sub"));
    for (const config of configs) fs.writeFileSync(path.join(tmp.dir, config), CONFIG_SOURCE);
    process.chdir(path.join(tmp.dir, "sub"));
    vi.stubEnv("TAILOR_CONFIG_PATH", undefined);
    vi.stubEnv("TAILOR_DTS_PATH", undefined);
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);

    try {
      const result = await runCliCommand(generateCommand, args);
      expect(result.error).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }

    const writtenTypes = configs
      .map((config) => path.join(path.dirname(config), "tailor.d.ts"))
      .filter((dts) => fs.existsSync(path.join(tmp.dir, dts)));
    expect(writtenTypes).toEqual([path.join(path.dirname(used), "tailor.d.ts")]);
  });
});
