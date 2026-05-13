import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { createWorkDirContext, importPath } from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("m19-plugins-define-plugins-rest", () => {
  test("plugins is registered via definePlugins and contains kysely + seed in order", async () => {
    const mod = await importPath(path.join(workDir, "tailor.config.ts"));
    expect(Array.isArray(mod.plugins)).toBe(true);
    expect(mod.plugins).toHaveLength(2);
    expect(mod.plugins[0].id).toBe("@tailor-platform/kysely-type");
    expect(mod.plugins[1].id).toBe("@tailor-platform/seed");
  });

  test("tailor.config.ts does not fall back to the deprecated defineGenerators API", () => {
    const source = fs.readFileSync(path.join(workDir, "tailor.config.ts"), "utf-8");
    expect(source).not.toMatch(/defineGenerators/);
    expect(source).toMatch(/definePlugins/);
  });
});
