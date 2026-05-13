import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { createWorkDirContext, importPath } from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("m25-cli-error-opaque-import", () => {
  test("tailor.config.ts imports kyselyTypePlugin from the SDK sub-path export", () => {
    const source = fs.readFileSync(path.join(workDir, "tailor.config.ts"), "utf-8");
    expect(source).toMatch(/from\s+["']@tailor-platform\/sdk\/plugin\/kysely-type["']/);
    expect(source).not.toMatch(/@tailor-platform\/kysely-types/);
  });

  test("plugins export now resolves kyselyTypePlugin successfully", async () => {
    const mod = await importPath(path.join(workDir, "tailor.config.ts"));
    expect(Array.isArray(mod.plugins)).toBe(true);
    expect(mod.plugins[0].id).toBe("@tailor-platform/kysely-type");
  });
});
