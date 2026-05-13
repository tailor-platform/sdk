import path from "node:path";
import { describe, expect, test } from "vitest";
import { createWorkDirContext, importPath } from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("m06-db-type-permission-role-gate", () => {
  test("audit model is named 'Audit' and exposes the message field", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/audit.ts"));
    expect(mod.audit.name).toBe("Audit");
    expect(Object.keys(mod.audit.fields)).toContain("message");
  });

  test("create and read are gated to logged-in users", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/audit.ts"));
    const record = mod.audit.metadata.permissions.record;
    expect(record).toBeDefined();
    for (const action of ["create", "read"] as const) {
      const policies = record[action];
      expect(Array.isArray(policies)).toBe(true);
      expect(policies.length).toBeGreaterThan(0);
      const first = policies[0];
      expect(first.permit).toBe(true);
      expect(first.conditions[0]).toEqual([{ user: "_loggedIn" }, "=", true]);
    }
  });

  test("update and delete are gated to role=ADMIN", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/audit.ts"));
    const record = mod.audit.metadata.permissions.record;
    for (const action of ["update", "delete"] as const) {
      const policies = record[action];
      expect(Array.isArray(policies)).toBe(true);
      expect(policies.length).toBeGreaterThan(0);
      const first = policies[0];
      expect(first.permit).toBe(true);
      expect(first.conditions[0]).toEqual([{ user: "role" }, "=", "ADMIN"]);
    }
  });
});
