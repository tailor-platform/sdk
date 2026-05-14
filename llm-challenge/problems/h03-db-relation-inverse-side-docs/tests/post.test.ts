import path from "node:path";
import { describe, expect, test } from "vitest";
import { createWorkDirContext, importPath } from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("h03-db-relation-inverse-side-docs", () => {
  test("post model is named 'Post' and exposes title and authorId", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/post.ts"));
    expect(mod.post.name).toBe("Post");
    const keys = Object.keys(mod.post.fields);
    expect(keys).toContain("title");
    expect(keys).toContain("authorId");
    expect(mod.post.fields.title.type).toBe("string");
    expect(mod.post.fields.authorId.type).toBe("uuid");
  });

  test("authorId carries a many-to-one relation toward the Author type", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/post.ts"));
    const field = mod.post.fields.authorId;
    expect(field.rawRelation).toBeDefined();
    expect(field.rawRelation.toward.type).toBe("Author");
    expect(["n-1", "manyToOne", "N-1"]).toContain(field.rawRelation.type);
  });

  test("forward-side handle is named 'author' via toward.as", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/post.ts"));
    const field = mod.post.fields.authorId;
    expect(field.rawRelation.toward.as).toBe("author");
  });

  test("inverse-side handle is named 'posts' via backward", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/post.ts"));
    const field = mod.post.fields.authorId;
    expect(field.rawRelation.backward).toBe("posts");
  });
});
