import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { createWorkDirContext, importPath } from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("m17-config-define-config-named-vs-default", () => {
  test("tailor.config.ts default-exports an object whose name is 'micro-challenge'", async () => {
    const mod = await importPath(path.join(workDir, "tailor.config.ts"));
    expect(mod.default).toBeDefined();
    expect(mod.default.name).toBe("micro-challenge");
  });

  test("config wires the tailordb files glob to ./tailordb/*.ts", async () => {
    const mod = await importPath(path.join(workDir, "tailor.config.ts"));
    expect(mod.default.db?.tailordb?.files).toEqual(["./tailordb/*.ts"]);
  });

  test("tailor.config.ts imports defineConfig and wraps the default export in a call", () => {
    const source = fs.readFileSync(path.join(workDir, "tailor.config.ts"), "utf-8");
    // Sourcecheck for the naming-bias affordance: the agent must reach for
    // defineConfig(...), not default-export a plain object literal that
    // happens to match the AppConfig shape.
    expect(source).toMatch(/from\s+["']@tailor-platform\/sdk["']/);
    expect(source).toMatch(/\bdefineConfig\b/);
    expect(source).toMatch(/export\s+default\s+defineConfig\s*\(/);
  });
});
