import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { createWorkDirContext, expectFieldType, importPath } from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

const targets = ["tailordb/article.ts", "tailordb/note.ts", "tailordb/post.ts"];

describe.skipIf(!workDirReady)("h12-cli-cascade-error-batch-fix", () => {
  test("no file still calls the removed db.text() builder", () => {
    for (const target of targets) {
      const source = fs.readFileSync(path.join(workDir, target), "utf-8");
      expect(source, `${target} should not call db.text()`).not.toMatch(/db\.text\s*\(/);
    }
  });

  test("article model has string title and summary", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/article.ts"));
    expect(mod.article.name).toBe("Article");
    expectFieldType(mod.article.fields.title, "string");
    expectFieldType(mod.article.fields.summary, "string");
  });

  test("note model has string heading and body", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/note.ts"));
    expect(mod.note.name).toBe("Note");
    expectFieldType(mod.note.fields.heading, "string");
    expectFieldType(mod.note.fields.body, "string");
  });

  test("post model has string subject, content, and excerpt", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/post.ts"));
    expect(mod.post.name).toBe("Post");
    expectFieldType(mod.post.fields.subject, "string");
    expectFieldType(mod.post.fields.content, "string");
    expectFieldType(mod.post.fields.excerpt, "string");
  });
});
