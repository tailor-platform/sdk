import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { createWorkDirContext, expectFieldType, importPath } from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("m24-cli-retry-loop-detection", () => {
  test("article model has string title and summary fields", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/article.ts"));
    expect(mod.article.name).toBe("Article");
    expectFieldType(mod.article.fields.title, "string", { required: true });
    expectFieldType(mod.article.fields.summary, "string", { required: true });
  });

  test("no lingering db.text() calls remain in tailordb/article.ts", () => {
    const source = fs.readFileSync(path.join(workDir, "tailordb/article.ts"), "utf-8");
    expect(source).not.toMatch(/db\.text\(/);
  });
});
