import path from "node:path";
import { describe, expect, test } from "vitest";
import { createWorkDirContext, importPath } from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("m22-cli-config-glob-mismatch", () => {
  test("tailor.config.ts globs match the existing Order model file", async () => {
    const mod = await importPath(path.join(workDir, "tailor.config.ts"));
    const files: string[] = mod.default.db.tailordb.files;
    expect(files.length).toBeGreaterThan(0);
    // The glob must cover .ts files; .tsx-only globs miss order.ts.
    const hasTsGlob = files.some((f) => /\*\.ts(\b|$)/.test(f));
    expect(hasTsGlob).toBe(true);
  });

  test("the Order model is still defined", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/order.ts"));
    expect(mod.order.name).toBe("Order");
  });
});
