import * as fs from "node:fs";
import * as path from "pathe";
import { describe, expect, test, vi } from "vitest";
import { generateCommand } from "#/cli/commands/generate/index";
import { runCliCommand } from "#/cli/shared/test-helpers/run-cli-command";
import { tempCwd } from "#/cli/shared/test-helpers/temp-cwd";

const CONFIG_SOURCE = `export default { name: "app" };\n`;

const PLUGIN_CONFIG_SOURCE = `export default { name: "app" };
export const plugins = [
  {
    id: "test-output",
    description: "Writes a file to a relative path",
    onTailorDBReady: () => ({ files: [{ path: "./generated/out.txt", content: "out" }] }),
  },
];
`;

const FAILING_PLUGIN_CONFIG_SOURCE = `export default { name: "app" };
export const plugins = [
  {
    id: "test-failure",
    description: "Fails while generating",
    onTailorDBReady: () => {
      throw new Error("plugin failed");
    },
  },
];
`;

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

  test.each([
    { name: "found in a parent directory", cwd: "app/sub", args: [] },
    {
      name: "given with --config from another directory",
      cwd: "other",
      args: ["--config", "../app/tailor.config.ts"],
    },
  ])(
    "writes plugin outputs relative to the config's directory when the config is $name",
    async ({ cwd, args }) => {
      using tmp = tempCwd("tailor-config-discovery-");
      const appDir = path.join(tmp.dir, "app");
      fs.mkdirSync(path.join(appDir, "sub"), { recursive: true });
      fs.mkdirSync(path.join(tmp.dir, "other"));
      fs.writeFileSync(path.join(appDir, "tailor.config.ts"), PLUGIN_CONFIG_SOURCE);
      const invocationDir = path.join(tmp.dir, cwd);
      process.chdir(invocationDir);
      vi.stubEnv("TAILOR_CONFIG_PATH", undefined);
      vi.stubEnv("TAILOR_DTS_PATH", undefined);

      try {
        const result = await runCliCommand(generateCommand, args);
        expect(result.error).toBeUndefined();
      } finally {
        vi.unstubAllEnvs();
      }

      expect(fs.readFileSync(path.join(appDir, "generated", "out.txt"), "utf-8")).toBe("out");
      expect(fs.existsSync(path.join(invocationDir, "generated"))).toBe(false);
      expect(fs.realpathSync(process.cwd())).toBe(fs.realpathSync(invocationDir));
    },
  );

  test("restores the working directory when a plugin fails", async () => {
    using tmp = tempCwd("tailor-config-discovery-");
    fs.mkdirSync(path.join(tmp.dir, "sub"));
    fs.writeFileSync(path.join(tmp.dir, "tailor.config.ts"), FAILING_PLUGIN_CONFIG_SOURCE);
    process.chdir(path.join(tmp.dir, "sub"));
    vi.stubEnv("TAILOR_CONFIG_PATH", undefined);
    vi.stubEnv("TAILOR_DTS_PATH", undefined);

    try {
      const result = await runCliCommand(generateCommand, []);
      expect(result.error?.message).toContain("Plugin generation failed");
    } finally {
      vi.unstubAllEnvs();
    }

    expect(fs.realpathSync(process.cwd())).toBe(fs.realpathSync(path.join(tmp.dir, "sub")));
  });
});
