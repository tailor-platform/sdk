import { describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";

const workDir = path.resolve(import.meta.dirname, "..", "work");
const workDirExists = fs.existsSync(workDir);

describe.skipIf(!workDirExists)("038-model-one-to-one-relation", () => {
  const profilePath = path.join(workDir, "tailordb/profile.ts");
  const userPath = path.join(workDir, "tailordb/user.ts");

  test("tailordb/profile.ts exists", () => {
    expect(fs.existsSync(profilePath)).toBe(true);
  });

  test("profile is a named export", async () => {
    const mod = await import(profilePath);
    expect(mod.profile).toBeDefined();
  });

  test("profile model has correct name", async () => {
    const { profile } = await import(profilePath);
    expect(profile.name).toBe("Profile");
  });

  test("profile model has all expected fields", async () => {
    const { profile } = await import(profilePath);
    const fieldNames = Object.keys(profile.fields);
    expect(fieldNames).toContain("id");
    expect(fieldNames).toContain("userId");
    expect(fieldNames).toContain("bio");
    expect(fieldNames).toContain("avatarUrl");
    expect(fieldNames).toContain("createdAt");
    expect(fieldNames).toContain("updatedAt");
  });

  test("userId field is a uuid type", async () => {
    const { profile } = await import(profilePath);
    expect(profile.fields.userId.type).toBe("uuid");
  });

  test("userId has a relation config", async () => {
    const { profile } = await import(profilePath);
    expect(profile.fields.userId.rawRelation).toBeDefined();
  });

  test("relation type is 1-1", async () => {
    const { profile } = await import(profilePath);
    const relType = profile.fields.userId.rawRelation.type;
    expect(relType === "1-1" || relType === "oneToOne").toBe(true);
  });

  test("relation toward.as is set to 'owner'", async () => {
    const { profile } = await import(profilePath);
    expect(profile.fields.userId.rawRelation.toward.as).toBe("owner");
  });

  test("relation backward is set to 'profile'", async () => {
    const { profile } = await import(profilePath);
    expect(profile.fields.userId.rawRelation.backward).toBe("profile");
  });

  test("bio is an optional string field", async () => {
    const { profile } = await import(profilePath);
    const field = profile.fields.bio;
    expect(field.type).toBe("string");
    expect(field.metadata.required).toBe(false);
  });

  test("avatarUrl is an optional string field", async () => {
    const { profile } = await import(profilePath);
    const field = profile.fields.avatarUrl;
    expect(field.type).toBe("string");
    expect(field.metadata.required).toBe(false);
  });

  test("user model can be imported without errors", async () => {
    const mod = await import(userPath);
    expect(mod.user).toBeDefined();
    expect(mod.user.name).toBe("User");
  });
});
