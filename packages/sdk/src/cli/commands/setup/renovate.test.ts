import * as fs from "node:fs";
import * as path from "pathe";
import { aroundEach, describe, expect, test } from "vitest";
import { readLock } from "./lock";
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

  test("generates a minimal root config and records setup without a content hash", async () => {
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
    expect(readLock(testDir)).toEqual({
      version: 2,
      targets: [],
      setups: [{ kind: "renovate", file: RENOVATE_CONFIG_FILE }],
    });
    expect(readLock(testDir)!.setups[0]).not.toHaveProperty("contentHash");
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
    expect(readLock(testDir)?.setups).toEqual([{ kind: "renovate", file: RENOVATE_CONFIG_FILE }]);
  });

  test("restores a missing config that is still recorded", async () => {
    await setupRenovate({ outputDir: testDir });
    fs.rmSync(path.join(testDir, RENOVATE_CONFIG_FILE));

    await setupRenovate({ outputDir: testDir });

    expect(fs.existsSync(path.join(testDir, RENOVATE_CONFIG_FILE))).toBe(true);
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
    expect(readLock(testDir)).toBeNull();
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

  test("refuses a dangling config symlink without writing outside the repository", async () => {
    fs.mkdirSync(outsideDir, { recursive: true });
    const outsideConfig = path.join(outsideDir, RENOVATE_CONFIG_FILE);
    fs.symlinkSync(outsideConfig, path.join(testDir, RENOVATE_CONFIG_FILE));

    await expect(setupRenovate({ outputDir: testDir })).rejects.toThrow(RENOVATE_CONFIG_FILE);

    expect(fs.lstatSync(path.join(testDir, RENOVATE_CONFIG_FILE)).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(outsideConfig)).toBe(false);
    expect(readLock(testDir)).toBeNull();
  });
});
