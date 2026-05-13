import path from "node:path";
import { describe, expect, test } from "vitest";
import { createWorkDirContext, importPath } from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("h01-tailordb-hooks-null-update-cascade", () => {
  test("document model is named 'Document' and exposes title, slug, version", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/document.ts"));
    expect(mod.document.name).toBe("Document");
    const keys = Object.keys(mod.document.fields);
    expect(keys).toContain("title");
    expect(keys).toContain("slug");
    expect(keys).toContain("version");
    expect(mod.document.fields.title.type).toBe("string");
    expect(mod.document.fields.slug.type).toBe("string");
    expect(mod.document.fields.version.type).toBe("integer");
  });

  test("title update hook trims and substitutes empty string for null", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/document.ts"));
    const hook = mod.document.fields.title.metadata.hooks.update;
    expect(typeof hook).toBe("function");
    expect(hook({ value: null, data: {}, user: {} })).toBe("");
    expect(hook({ value: "  Hello  ", data: {}, user: {} })).toBe("Hello");
  });

  test("slug update hook lowercases and substitutes empty string for null", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/document.ts"));
    const hook = mod.document.fields.slug.metadata.hooks.update;
    expect(typeof hook).toBe("function");
    expect(hook({ value: null, data: {}, user: {} })).toBe("");
    expect(hook({ value: "MyDoc", data: {}, user: {} })).toBe("mydoc");
  });

  test("version update hook increments and treats null as 0", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/document.ts"));
    const hook = mod.document.fields.version.metadata.hooks.update;
    expect(typeof hook).toBe("function");
    expect(hook({ value: null, data: {}, user: {} })).toBe(1);
    expect(hook({ value: 4, data: {}, user: {} })).toBe(5);
  });
});
