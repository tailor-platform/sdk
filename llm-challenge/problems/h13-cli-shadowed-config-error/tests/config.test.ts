import path from "node:path";
import { describe, expect, test } from "vitest";
import { createWorkDirContext, importPath } from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("h13-cli-shadowed-config-error", () => {
  test("tailor.config.ts default export is the defineConfig output directly", async () => {
    const mod = await importPath(path.join(workDir, "tailor.config.ts"));
    expect(mod.default).toBeDefined();
    expect(mod.default.name).toBe("micro-challenge");
    expect(mod.default.db).toBeDefined();
    expect(mod.default.db.tailordb).toBeDefined();
    expect(mod.default.db.tailordb.files).toEqual(["./tailordb/*.ts"]);
  });

  test("default export is not wrapped under tailor/config/app indirection", async () => {
    const mod = await importPath(path.join(workDir, "tailor.config.ts"));
    expect(mod.default.tailor).toBeUndefined();
    expect(mod.default.config).toBeUndefined();
    expect(mod.default.app).toBeUndefined();
  });

  test("the note model file imports cleanly", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/note.ts"));
    expect(mod.note.name).toBe("Note");
    expect(mod.note.fields.heading.type).toBe("string");
    expect(mod.note.fields.body.type).toBe("string");
  });
});
