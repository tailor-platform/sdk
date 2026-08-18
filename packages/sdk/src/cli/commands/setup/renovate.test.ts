import * as fs from "node:fs";
import * as path from "pathe";
import { runCommand } from "politty";
import { aroundEach, describe, expect, test } from "vitest";
import { captureStderr } from "#/cli/shared/test-helpers/capture-output";
import { RENOVATE_CONFIG_FILE, RENOVATE_PRESET, setupRenovate } from "./renovate";
import { setupCommand } from "./index";

describe("setupRenovate", () => {
  const testDir = path.join(
    "/tmp",
    `setup-renovate-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const outsideDir = `${testDir}-outside`;

  aroundEach(async (runTest) => {
    fs.mkdirSync(testDir, { recursive: true });
    await runTest();
    fs.rmSync(testDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  test("generates a minimal root config extending the shared preset", async () => {
    await setupRenovate({ outputDir: testDir });

    expect(fs.readFileSync(path.join(testDir, RENOVATE_CONFIG_FILE), "utf-8")).toBe(
      `${JSON.stringify(
        {
          $schema: "https://docs.renovatebot.com/renovate-schema.json",
          extends: [RENOVATE_PRESET],
        },
        null,
        2,
      )}\n`,
    );
  });

  test("dispatches the deprecated renovate alias to the deps command with a warning", async () => {
    using stderr = captureStderr();
    const originalArgv = process.argv;
    const originalCwd = process.cwd();
    process.argv = ["node", "tailor", "setup", "renovate"];
    process.chdir(testDir);
    try {
      await runCommand(setupCommand, ["renovate"]);
    } finally {
      process.argv = originalArgv;
      process.chdir(originalCwd);
    }

    expect(fs.existsSync(path.join(testDir, RENOVATE_CONFIG_FILE))).toBe(true);
    expect(stderr.output).toContain("`tailor setup renovate` is deprecated");
  });

  test("does not warn when the canonical deps command is invoked", async () => {
    using stderr = captureStderr();
    const originalArgv = process.argv;
    const originalCwd = process.cwd();
    process.argv = ["node", "tailor", "setup", "deps"];
    process.chdir(testDir);
    try {
      await runCommand(setupCommand, ["deps"]);
    } finally {
      process.argv = originalArgv;
      process.chdir(originalCwd);
    }

    expect(fs.existsSync(path.join(testDir, RENOVATE_CONFIG_FILE))).toBe(true);
    expect(stderr.output).not.toContain("deprecated");
  });

  test("does not write a lock file", async () => {
    await setupRenovate({ outputDir: testDir });

    expect(fs.existsSync(path.join(testDir, ".github/tailor.lock"))).toBe(false);
  });

  test("does not overwrite user edits when rerun", async () => {
    await setupRenovate({ outputDir: testDir });
    const configPath = path.join(testDir, RENOVATE_CONFIG_FILE);
    const edited = `${JSON.stringify(
      {
        extends: [RENOVATE_PRESET],
        packageRules: [{ matchPackageNames: ["example"], enabled: false }],
      },
      null,
      2,
    )}\n`;
    fs.writeFileSync(configPath, edited);

    await setupRenovate({ outputDir: testDir });

    expect(fs.readFileSync(configPath, "utf-8")).toBe(edited);
  });

  test("appends the preset to a plain-JSON config that lacks it, keeping its other keys", async () => {
    const configPath = path.join(testDir, RENOVATE_CONFIG_FILE);
    fs.writeFileSync(
      configPath,
      `${JSON.stringify(
        { extends: ["config:recommended"], packageRules: [{ matchPackageNames: ["example"] }] },
        null,
        2,
      )}\n`,
    );

    await setupRenovate({ outputDir: testDir });

    expect(JSON.parse(fs.readFileSync(configPath, "utf-8"))).toEqual({
      extends: ["config:recommended", RENOVATE_PRESET],
      packageRules: [{ matchPackageNames: ["example"] }],
    });
  });

  test("appends the preset to a plain-JSON config that has no extends key", async () => {
    const configPath = path.join(testDir, RENOVATE_CONFIG_FILE);
    fs.writeFileSync(configPath, `${JSON.stringify({ labels: ["deps"] }, null, 2)}\n`);

    await setupRenovate({ outputDir: testDir });

    expect(JSON.parse(fs.readFileSync(configPath, "utf-8"))).toEqual({
      labels: ["deps"],
      extends: [RENOVATE_PRESET],
    });
  });

  test("preserves the existing indentation and trailing newline when appending", async () => {
    const configPath = path.join(testDir, RENOVATE_CONFIG_FILE);
    fs.writeFileSync(configPath, `${JSON.stringify({ labels: ["deps"] }, null, 4)}\n`);

    await setupRenovate({ outputDir: testDir });

    const written = fs.readFileSync(configPath, "utf-8");
    expect(written).toBe(
      `${JSON.stringify({ labels: ["deps"], extends: [RENOVATE_PRESET] }, null, 4)}\n`,
    );
  });

  test("refuses to append when extends is not an array", async () => {
    const configPath = path.join(testDir, RENOVATE_CONFIG_FILE);
    const customized = `${JSON.stringify({ extends: "config:recommended" }, null, 2)}\n`;
    fs.writeFileSync(configPath, customized);

    await expect(setupRenovate({ outputDir: testDir })).rejects.toThrow(/non-array "extends"/);

    expect(fs.readFileSync(configPath, "utf-8")).toBe(customized);
  });

  test.each([
    ["renovate.jsonc", '{\n  // comment\n  "extends": []\n}\n'],
    ["renovate.json5", "{\n  extends: [],\n}\n"],
    [".renovaterc", '{\n  "extends": [],\n}\n'],
  ])("reports an unparseable config at %s instead of a generic message", async (file, content) => {
    const configPath = path.join(testDir, file);
    fs.writeFileSync(configPath, content);

    await expect(setupRenovate({ outputDir: testDir })).rejects.toThrow(
      /could not parse it as JSON/,
    );

    expect(fs.readFileSync(configPath, "utf-8")).toBe(content);
  });

  test("treats a config already extending the preset as set up", async () => {
    const configPath = path.join(testDir, ".github/renovate.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const existing = `${JSON.stringify({ extends: [RENOVATE_PRESET] }, null, 2)}\n`;
    fs.writeFileSync(configPath, existing);

    await setupRenovate({ outputDir: testDir });

    expect(fs.existsSync(path.join(testDir, RENOVATE_CONFIG_FILE))).toBe(false);
    expect(fs.readFileSync(configPath, "utf-8")).toBe(existing);
  });

  test("treats a package.json config already extending the preset as set up", async () => {
    const packageJsonPath = path.join(testDir, "package.json");
    const existing = `${JSON.stringify({ renovate: { extends: [RENOVATE_PRESET] } }, null, 2)}\n`;
    fs.writeFileSync(packageJsonPath, existing);

    await setupRenovate({ outputDir: testDir });

    expect(fs.existsSync(path.join(testDir, RENOVATE_CONFIG_FILE))).toBe(false);
    expect(fs.readFileSync(packageJsonPath, "utf-8")).toBe(existing);
  });

  test("does not treat a directory as a config extending the preset", async () => {
    const configPath = path.join(testDir, RENOVATE_CONFIG_FILE);
    fs.mkdirSync(configPath);

    await expect(setupRenovate({ outputDir: testDir })).rejects.toThrow(/could not parse it/);

    expect(fs.lstatSync(configPath).isDirectory()).toBe(true);
  });

  test("does not treat a symbolic link as a config extending the preset", async () => {
    const configPath = path.join(testDir, RENOVATE_CONFIG_FILE);
    const outsideConfig = path.join(outsideDir, RENOVATE_CONFIG_FILE);
    fs.mkdirSync(outsideDir, { recursive: true });
    const outsideContent = `${JSON.stringify({ extends: [RENOVATE_PRESET] })}\n`;
    fs.writeFileSync(outsideConfig, outsideContent);
    fs.symlinkSync(outsideConfig, configPath);

    await expect(setupRenovate({ outputDir: testDir })).rejects.toThrow(/could not parse it/);

    expect(fs.lstatSync(configPath).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(outsideConfig, "utf-8")).toBe(outsideContent);
  });

  test.each([
    "renovate.json",
    "renovate.jsonc",
    "renovate.json5",
    ".github/renovate.json",
    ".github/renovate.jsonc",
    ".github/renovate.json5",
    ".gitlab/renovate.json",
    ".gitlab/renovate.jsonc",
    ".gitlab/renovate.json5",
    ".renovaterc",
    ".renovaterc.json",
    ".renovaterc.jsonc",
    ".renovaterc.json5",
  ])("appends the preset in place at %s instead of writing a new config", async (relativePath) => {
    const configPath = path.join(testDir, relativePath);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, "{}\n");

    await setupRenovate({ outputDir: testDir });

    expect(JSON.parse(fs.readFileSync(configPath, "utf-8"))).toEqual({
      extends: [RENOVATE_PRESET],
    });
    expect(fs.readdirSync(testDir)).toEqual([relativePath.split("/")[0]]);
  });

  test("appends the preset to a package.json Renovate config without disturbing other fields", async () => {
    const packageJsonPath = path.join(testDir, "package.json");
    fs.writeFileSync(
      packageJsonPath,
      `${JSON.stringify(
        { name: "example", renovate: { extends: ["config:recommended"] } },
        null,
        2,
      )}\n`,
    );

    await setupRenovate({ outputDir: testDir });

    expect(JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"))).toEqual({
      name: "example",
      renovate: { extends: ["config:recommended", RENOVATE_PRESET] },
    });
    expect(fs.existsSync(path.join(testDir, RENOVATE_CONFIG_FILE))).toBe(false);
  });

  test("allows package.json when it has no Renovate config", async () => {
    fs.writeFileSync(path.join(testDir, "package.json"), '{"name":"example"}\n');

    await setupRenovate({ outputDir: testDir });

    expect(fs.existsSync(path.join(testDir, RENOVATE_CONFIG_FILE))).toBe(true);
  });

  test("throws when package.json is not valid JSON", async () => {
    fs.writeFileSync(path.join(testDir, "package.json"), "{ not json");

    await expect(setupRenovate({ outputDir: testDir })).rejects.toThrow(
      /package\.json is not valid JSON/,
    );
    expect(fs.existsSync(path.join(testDir, RENOVATE_CONFIG_FILE))).toBe(false);
  });

  test("refuses a dangling config symlink without writing outside the repository", async () => {
    fs.mkdirSync(outsideDir, { recursive: true });
    const outsideConfig = path.join(outsideDir, RENOVATE_CONFIG_FILE);
    fs.symlinkSync(outsideConfig, path.join(testDir, RENOVATE_CONFIG_FILE));

    await expect(setupRenovate({ outputDir: testDir })).rejects.toThrow(/could not parse it/);

    expect(fs.lstatSync(path.join(testDir, RENOVATE_CONFIG_FILE)).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(outsideConfig)).toBe(false);
  });
});
