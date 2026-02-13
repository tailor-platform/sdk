import { describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";

const workDir = path.resolve(import.meta.dirname, "..", "work");
const workDirExists = fs.existsSync(workDir);

describe.skipIf(!workDirExists)("022-model-permissions", () => {
  const documentPath = path.join(workDir, "tailordb/document.ts");

  test("tailordb/document.ts exists", () => {
    expect(fs.existsSync(documentPath)).toBe(true);
  });

  test("document is a named export", async () => {
    const mod = await import(documentPath);
    expect(mod.document).toBeDefined();
  });

  test("model name is 'Document'", async () => {
    const { document } = await import(documentPath);
    expect(document.name).toBe("Document");
  });

  test("has all required fields", async () => {
    const { document } = await import(documentPath);
    const fieldNames = Object.keys(document.fields);
    expect(fieldNames).toContain("id");
    expect(fieldNames).toContain("title");
    expect(fieldNames).toContain("content");
    expect(fieldNames).toContain("ownerId");
    expect(fieldNames).toContain("isPublic");
    expect(fieldNames).toContain("createdAt");
    expect(fieldNames).toContain("updatedAt");
  });

  test("title is a required string field", async () => {
    const { document } = await import(documentPath);
    const field = document.fields.title;
    expect(field.type).toBe("string");
    expect(field.metadata.required).toBe(true);
  });

  test("content is an optional string field", async () => {
    const { document } = await import(documentPath);
    const field = document.fields.content;
    expect(field.type).toBe("string");
    expect(field.metadata.required).toBe(false);
  });

  test("ownerId is a required uuid field", async () => {
    const { document } = await import(documentPath);
    const field = document.fields.ownerId;
    expect(field.type).toBe("uuid");
    expect(field.metadata.required).toBe(true);
  });

  test("isPublic is a required boolean field", async () => {
    const { document } = await import(documentPath);
    const field = document.fields.isPublic;
    expect(field.type).toBe("boolean");
    expect(field.metadata.required).toBe(true);
  });

  test("has record permission defined", async () => {
    const { document } = await import(documentPath);
    expect(document.metadata.permissions.record).toBeDefined();
  });

  test("permission create has 1 rule with permit true", async () => {
    const { document } = await import(documentPath);
    const perm = document.metadata.permissions.record;
    expect(perm.create).toHaveLength(1);
    expect(perm.create[0].permit).toBe(true);
  });

  test("permission read has 2 rules", async () => {
    const { document } = await import(documentPath);
    const perm = document.metadata.permissions.record;
    expect(perm.read).toHaveLength(2);
  });

  test("permission update has 1 rule with permit true", async () => {
    const { document } = await import(documentPath);
    const perm = document.metadata.permissions.record;
    expect(perm.update).toHaveLength(1);
    expect(perm.update[0].permit).toBe(true);
  });

  test("permission delete has 1 rule with permit true", async () => {
    const { document } = await import(documentPath);
    const perm = document.metadata.permissions.record;
    expect(perm.delete).toHaveLength(1);
    expect(perm.delete[0].permit).toBe(true);
  });

  test("create permission condition references user._loggedIn", async () => {
    const { document } = await import(documentPath);
    const perm = document.metadata.permissions.record;
    const condition = perm.create[0].conditions[0];
    expect(condition[0]).toEqual({ user: "_loggedIn" });
  });

  test("read permission first rule references record.isPublic", async () => {
    const { document } = await import(documentPath);
    const perm = document.metadata.permissions.record;
    const condition = perm.read[0].conditions[0];
    expect(condition[0]).toEqual({ record: "isPublic" });
  });

  test("update permission uses newRecord for ownerId check", async () => {
    const { document } = await import(documentPath);
    const perm = document.metadata.permissions.record;
    const condition = perm.update[0].conditions[0];
    expect(condition[0]).toEqual({ newRecord: "ownerId" });
  });

  test("has gqlPermission defined", async () => {
    const { document } = await import(documentPath);
    expect(document.metadata.permissions.gql).toBeDefined();
  });

  test("gqlPermission has 2 policies", async () => {
    const { document } = await import(documentPath);
    const gql = document.metadata.permissions.gql;
    expect(gql).toHaveLength(2);
  });

  test("first gqlPermission policy has actions ['read', 'create']", async () => {
    const { document } = await import(documentPath);
    const gql = document.metadata.permissions.gql;
    expect(gql[0].actions).toEqual(["read", "create"]);
  });

  test("second gqlPermission policy has actions 'all'", async () => {
    const { document } = await import(documentPath);
    const gql = document.metadata.permissions.gql;
    expect(gql[1].actions).toBe("all");
  });

  test("timestamps are present with correct types", async () => {
    const { document } = await import(documentPath);
    expect(document.fields.createdAt.type).toBe("datetime");
    expect(document.fields.updatedAt.type).toBe("datetime");
  });
});
