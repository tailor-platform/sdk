import * as fs from "node:fs";
import * as path from "pathe";
import { aroundEach, describe, expect, test } from "vitest";
import { RENOVATE_CONFIG_FILE, RENOVATE_PRESET, setupRenovate } from "./renovate";

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

  test("does not regenerate over a config the user emptied of the preset", async () => {
    const configPath = path.join(testDir, RENOVATE_CONFIG_FILE);
    const customized = `${JSON.stringify(
      { extends: ["config:recommended"], packageRules: [{ matchPackageNames: ["example"] }] },
      null,
      2,
    )}\n`;
    fs.writeFileSync(configPath, customized);

    await expect(setupRenovate({ outputDir: testDir })).rejects.toThrow(/already exists/);

    expect(fs.readFileSync(configPath, "utf-8")).toBe(customized);
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

    await expect(setupRenovate({ outputDir: testDir })).rejects.toThrow(/already exists/);

    expect(fs.lstatSync(configPath).isDirectory()).toBe(true);
  });

  test("does not treat a symbolic link as a config extending the preset", async () => {
    const configPath = path.join(testDir, RENOVATE_CONFIG_FILE);
    const outsideConfig = path.join(outsideDir, RENOVATE_CONFIG_FILE);
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(outsideConfig, `${JSON.stringify({ extends: [RENOVATE_PRESET] })}\n`);
    fs.symlinkSync(outsideConfig, configPath);

    await expect(setupRenovate({ outputDir: testDir })).rejects.toThrow(/already exists/);

    expect(fs.lstatSync(configPath).isSymbolicLink()).toBe(true);
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
  ])("refuses to overwrite an existing config at %s", async (relativePath) => {
    const configPath = path.join(testDir, relativePath);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, "{}\n");

    await expect(setupRenovate({ outputDir: testDir })).rejects.toThrow(relativePath);
    expect(fs.readFileSync(configPath, "utf-8")).toBe("{}\n");
  });

  test("refuses to shadow a package.json Renovate config", async () => {
    fs.writeFileSync(
      path.join(testDir, "package.json"),
      `${JSON.stringify({ renovate: { extends: ["config:recommended"] } }, null, 2)}\n`,
    );

    await expect(setupRenovate({ outputDir: testDir })).rejects.toThrow(/package\.json.*renovate/);
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

    await expect(setupRenovate({ outputDir: testDir })).rejects.toThrow(RENOVATE_CONFIG_FILE);

    expect(fs.lstatSync(path.join(testDir, RENOVATE_CONFIG_FILE)).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(outsideConfig)).toBe(false);
  });
});
