import path from "node:path";
import { describe, expect, test } from "vitest";
import { createWorkDirContext, importPath } from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("h02-db-type-permission-tuple-compose", () => {
  test("document model is named 'Document' and exposes title and ownerId", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/document.ts"));
    expect(mod.document.name).toBe("Document");
    const keys = Object.keys(mod.document.fields);
    expect(keys).toContain("title");
    expect(keys).toContain("ownerId");
    expect(mod.document.fields.title.type).toBe("string");
    expect(mod.document.fields.ownerId.type).toBe("string");
  });

  test("update permission has exactly one policy entry with two AND-ed conditions", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/document.ts"));
    const update = mod.document.metadata.permissions.record.update;
    expect(Array.isArray(update)).toBe(true);
    expect(update.length).toBe(1);

    const policy = update[0];
    expect(policy.permit).toBe(true);
    expect(Array.isArray(policy.conditions)).toBe(true);
    expect(policy.conditions.length).toBe(2);
  });

  test("update conditions compose newRecord.ownerId == user.id and user.role == 'editor'", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/document.ts"));
    const conditions = mod.document.metadata.permissions.record.update[0].conditions;

    const hasOwnerCondition = conditions.some(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic tuple shape
      (cond: any) =>
        Array.isArray(cond) &&
        cond.length === 3 &&
        cond[1] === "=" &&
        ((cond[0]?.newRecord === "ownerId" && cond[2]?.user === "id") ||
          (cond[2]?.newRecord === "ownerId" && cond[0]?.user === "id")),
    );
    expect(hasOwnerCondition).toBe(true);

    const hasRoleCondition = conditions.some(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic tuple shape
      (cond: any) =>
        Array.isArray(cond) &&
        cond.length === 3 &&
        cond[1] === "=" &&
        ((cond[0]?.user === "role" && cond[2] === "editor") ||
          (cond[2]?.user === "role" && cond[0] === "editor")),
    );
    expect(hasRoleCondition).toBe(true);
  });

  test("create, read, and delete actions are filled with permissive single-policy entries", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/document.ts"));
    const record = mod.document.metadata.permissions.record;
    for (const action of ["create", "read", "delete"] as const) {
      const policies = record[action];
      expect(Array.isArray(policies)).toBe(true);
      expect(policies.length).toBe(1);
      expect(policies[0].permit).toBe(true);
    }
  });
});
