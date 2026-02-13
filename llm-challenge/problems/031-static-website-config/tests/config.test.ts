import { describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";

const workDir = path.resolve(import.meta.dirname, "..", "work");
const workDirExists = fs.existsSync(workDir);

describe.skipIf(!workDirExists)("031-static-website-config", () => {
  const configPath = path.join(workDir, "tailor.config.ts");

  test("tailor.config.ts exists", () => {
    expect(fs.existsSync(configPath)).toBe(true);
  });

  test("has default export", async () => {
    const mod = await import(configPath);
    expect(mod.default).toBeDefined();
  });

  test("config name is 'challenge-031'", async () => {
    const mod = await import(configPath);
    const config = mod.default;
    expect(config.name).toBe("challenge-031");
  });

  test("config has db.tailordb defined", async () => {
    const mod = await import(configPath);
    const config = mod.default;
    expect(config.db).toBeDefined();
    expect(config.db.tailordb).toBeDefined();
  });

  test("config has cors array with at least 1 entry", async () => {
    const mod = await import(configPath);
    const config = mod.default;
    expect(config.cors).toBeDefined();
    expect(Array.isArray(config.cors)).toBe(true);
    expect(config.cors.length).toBeGreaterThanOrEqual(1);
  });

  test("config has staticWebsites array with at least 1 entry", async () => {
    const mod = await import(configPath);
    const config = mod.default;
    expect(config.staticWebsites).toBeDefined();
    expect(Array.isArray(config.staticWebsites)).toBe(true);
    expect(config.staticWebsites.length).toBeGreaterThanOrEqual(1);
  });

  test("first static website name is 'my-storefront'", async () => {
    const mod = await import(configPath);
    const config = mod.default;
    expect(config.staticWebsites[0].name).toBe("my-storefront");
  });

  test("first static website has description", async () => {
    const mod = await import(configPath);
    const config = mod.default;
    expect(config.staticWebsites[0].description).toBeDefined();
    expect(config.staticWebsites[0].description).toBe("Storefront application");
  });
});
