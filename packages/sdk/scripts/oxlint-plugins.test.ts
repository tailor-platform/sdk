import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const sdkDir = resolve(currentDir, "..");
const require = createRequire(import.meta.url);
const oxlintPackageJson = require.resolve("oxlint/package.json");
const oxlintBin = resolve(dirname(oxlintPackageJson), "bin/oxlint");
const pluginUrl = pathToFileURL(resolve(sdkDir, "oxlint-plugins/index.js")).href;

type OxlintResult = {
  status: number | null;
  output: string;
};

describe("local oxlint plugin", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tailor-oxlint-plugin-"));
    configPath = join(tmpDir, ".oxlintrc.json");
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          jsPlugins: [pluginUrl],
          rules: {
            "local/no-cli-hybrid-command": "error",
          },
        },
        null,
        2,
      ),
      "utf-8",
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeFixture(name: string, code: string): string {
    const fixturePath = join(tmpDir, name);
    writeFileSync(fixturePath, code, "utf-8");
    return fixturePath;
  }

  function runOxlint(fixturePath: string): OxlintResult {
    const result = spawnSync(oxlintBin, ["--config", configPath, fixturePath], {
      cwd: sdkDir,
      encoding: "utf-8",
      env: { ...process.env, FORCE_COLOR: "0" },
      timeout: 20_000,
    });
    return {
      status: result.status,
      output: `${result.stdout}${result.stderr}`,
    };
  }

  test("reports commands that combine subcommands with a positional run", () => {
    const fixturePath = writeFixture(
      "hybrid.ts",
      `
import { arg, defineCommand } from "politty";
import { z } from "zod";

const listCommand = defineCommand({
  name: "list",
  run() {},
});

export const cacheCommand = defineCommand({
  name: "cache",
  subCommands: {
    list: listCommand,
  },
  args: z.object({
    key: arg(z.string(), { positional: true }),
  }),
  run(args) {
    return args.key;
  },
});
`,
    );

    const result = runOxlint(fixturePath);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("local(no-cli-hybrid-command)");
    expect(result.output).toContain("Move the positional argument to a leaf subcommand");
  });

  test("reports commands when positional args are assigned to a variable", () => {
    const fixturePath = writeFixture(
      "variable-args.ts",
      `
import { arg, defineCommand } from "politty";
import { z } from "zod";

const commandArgs = z.object({
  key: arg(z.string(), { positional: true }),
});

const listCommand = defineCommand({
  name: "list",
  run() {},
});

export const cacheCommand = defineCommand({
  name: "cache",
  subCommands: {
    list: listCommand,
  },
  args: commandArgs,
  run(args) {
    return args.key;
  },
});
`,
    );

    const result = runOxlint(fixturePath);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("local(no-cli-hybrid-command)");
  });

  test("reports commands when positional args are inside chained schemas", () => {
    const fixturePath = writeFixture(
      "chained-args.ts",
      `
import { arg, defineCommand } from "politty";
import { z } from "zod";

const listCommand = defineCommand({
  name: "list",
  run() {},
});

export const cacheCommand = defineCommand({
  name: "cache",
  subCommands: {
    list: listCommand,
  },
  args: z.object({
    key: arg(z.string(), { positional: true }),
  }).strict(),
  run(args) {
    return args.key;
  },
});
`,
    );

    const result = runOxlint(fixturePath);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("local(no-cli-hybrid-command)");
  });

  test("allows parent commands that only forward to a subcommand", () => {
    const fixturePath = writeFixture(
      "forwarding-parent.ts",
      `
import { defineCommand, runCommand } from "politty";

const listCommand = defineCommand({
  name: "list",
  run() {},
});

export const cacheCommand = defineCommand({
  name: "cache",
  subCommands: {
    list: listCommand,
  },
  async run() {
    await runCommand(listCommand, []);
  },
});
`,
    );

    const result = runOxlint(fixturePath);

    expect(result.status).toBe(0);
    expect(result.output).not.toContain("local(no-cli-hybrid-command)");
  });

  test("allows leaf commands with positional arguments", () => {
    const fixturePath = writeFixture(
      "leaf.ts",
      `
import { arg, defineCommand } from "politty";
import { z } from "zod";

export const getCommand = defineCommand({
  name: "get",
  args: z.object({
    key: arg(z.string(), { positional: true }),
  }),
  run(args) {
    return args.key;
  },
});
`,
    );

    const result = runOxlint(fixturePath);

    expect(result.status).toBe(0);
    expect(result.output).not.toContain("local(no-cli-hybrid-command)");
  });
});
