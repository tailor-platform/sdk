import { describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";

const workDir = path.resolve(import.meta.dirname, "..", "work");
const workDirExists = fs.existsSync(workDir);

describe.skipIf(!workDirExists)("001-simple-model", () => {
  const postPath = path.join(workDir, "tailordb/post.ts");

  test("tailordb/post.ts exists", () => {
    expect(fs.existsSync(postPath)).toBe(true);
  });

  test("post is a named export", async () => {
    const mod = await import(postPath);
    expect(mod.post).toBeDefined();
  });

  test("post model has correct name", async () => {
    const { post } = await import(postPath);
    expect(post.name).toBe("Post");
  });

  test("post model has all required fields", async () => {
    const { post } = await import(postPath);
    const fieldNames = Object.keys(post.fields);
    expect(fieldNames).toContain("id");
    expect(fieldNames).toContain("title");
    expect(fieldNames).toContain("content");
    expect(fieldNames).toContain("published");
    expect(fieldNames).toContain("category");
    expect(fieldNames).toContain("createdAt");
    expect(fieldNames).toContain("updatedAt");
  });

  test("title is a required string field", async () => {
    const { post } = await import(postPath);
    const field = post.fields.title;
    expect(field.type).toBe("string");
    expect(field.metadata.required).toBe(true);
  });

  test("content is an optional string field", async () => {
    const { post } = await import(postPath);
    const field = post.fields.content;
    expect(field.type).toBe("string");
    expect(field.metadata.required).toBe(false);
  });

  test("published is a required boolean field", async () => {
    const { post } = await import(postPath);
    const field = post.fields.published;
    expect(field.type).toBe("boolean");
    expect(field.metadata.required).toBe(true);
  });

  test("category is an enum field with correct values", async () => {
    const { post } = await import(postPath);
    const field = post.fields.category;
    expect(field.type).toBe("enum");
    expect(field.metadata.required).toBe(true);

    const values = field.metadata.allowedValues.map((v: { value: string }) => v.value);
    expect(values).toEqual(["tech", "lifestyle", "news", "other"]);
  });

  test("timestamps are present with correct types", async () => {
    const { post } = await import(postPath);
    expect(post.fields.createdAt.type).toBe("datetime");
    expect(post.fields.updatedAt.type).toBe("datetime");
  });
});
