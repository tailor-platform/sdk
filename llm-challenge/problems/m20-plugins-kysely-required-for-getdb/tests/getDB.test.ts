import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { createWorkDirContext, importPath } from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("m20-plugins-kysely-required-for-getdb", () => {
  test("plugins export registers kyselyTypePlugin", async () => {
    const mod = await importPath(path.join(workDir, "tailor.config.ts"));
    expect(Array.isArray(mod.plugins)).toBe(true);
    const kysely = mod.plugins.find((p: { id: string }) => p.id === "@tailor-platform/kysely-type");
    expect(kysely).toBeDefined();
    expect(kysely.pluginConfig.distPath).toBe("./generated/tailordb.ts");
  });

  test("generated/tailordb.ts exists and exposes getDB", async () => {
    const generatedPath = path.join(workDir, "generated/tailordb.ts");
    expect(fs.existsSync(generatedPath)).toBe(true);
    const source = fs.readFileSync(generatedPath, "utf-8");
    expect(source).toMatch(/getDB/);
    expect(source).toMatch(/Invoice/);
  });
});
