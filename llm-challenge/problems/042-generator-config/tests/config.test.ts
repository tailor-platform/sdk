import { describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";

const workDir = path.resolve(import.meta.dirname, "..", "work");
const workDirExists = fs.existsSync(workDir);

describe.skipIf(!workDirExists)("042-generator-config", () => {
  const configPath = path.join(workDir, "tailor.config.ts");

  test("tailor.config.ts exists", () => {
    expect(fs.existsSync(configPath)).toBe(true);
  });

  test("has default export", async () => {
    const mod = await import(configPath);
    expect(mod.default).toBeDefined();
  });

  test("config name is 'challenge-042'", async () => {
    const mod = await import(configPath);
    expect(mod.default.name).toBe("challenge-042");
  });

  test("has named export 'generators'", async () => {
    const mod = await import(configPath);
    expect(mod.generators).toBeDefined();
  });

  test("generators is an array", async () => {
    const mod = await import(configPath);
    expect(Array.isArray(mod.generators)).toBe(true);
  });

  test("generators has 2 entries", async () => {
    const mod = await import(configPath);
    expect(mod.generators).toHaveLength(2);
  });

  test("first generator is '@tailor-platform/kysely-type'", async () => {
    const mod = await import(configPath);
    expect(mod.generators[0][0]).toBe("@tailor-platform/kysely-type");
  });

  test("first generator has distPath './generated/db.ts'", async () => {
    const mod = await import(configPath);
    expect(mod.generators[0][1].distPath).toBe("./generated/db.ts");
  });

  test("second generator is '@tailor-platform/enum-constants'", async () => {
    const mod = await import(configPath);
    expect(mod.generators[1][0]).toBe("@tailor-platform/enum-constants");
  });

  test("second generator has distPath './generated/enums.ts'", async () => {
    const mod = await import(configPath);
    expect(mod.generators[1][1].distPath).toBe("./generated/enums.ts");
  });

  test("config has db.tailordb defined", async () => {
    const mod = await import(configPath);
    expect(mod.default.db).toBeDefined();
    expect(mod.default.db.tailordb).toBeDefined();
  });
});
