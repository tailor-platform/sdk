import path from "node:path";
import { describe, expect, test } from "vitest";
import { createWorkDirContext, importPath } from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("m02-db-field-array-vs-list", () => {
  test("post model is named 'Post' and exposes the tags field", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/post.ts"));
    expect(mod.post.name).toBe("Post");
    expect(Object.keys(mod.post.fields)).toContain("tags");
  });

  test("tags is an optional, array-valued string field", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/post.ts"));
    expect(mod.post.fields.tags.type).toBe("string");
    expect(mod.post.fields.tags.metadata.array).toBe(true);
    expect(mod.post.fields.tags.metadata.required).toBe(false);
  });
});
