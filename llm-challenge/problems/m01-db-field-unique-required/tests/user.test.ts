import path from "node:path";
import { describe, expect, test } from "vitest";
import { createWorkDirContext, expectFieldType, importPath } from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("m01-db-field-unique-required", () => {
  test("user model is named 'User' and exposes the email field", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/user.ts"));
    expect(mod.user.name).toBe("User");
    expect(Object.keys(mod.user.fields)).toContain("email");
  });

  test("email is a required + unique string field", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/user.ts"));
    expectFieldType(mod.user.fields.email, "string", { required: true, unique: true });
  });
});
