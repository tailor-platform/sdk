import path from "node:path";
import { describe, expect, test } from "vitest";
import { createWorkDirContext, importPath } from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("m03-db-field-relation-n-to-1", () => {
  test("membership model is named 'Membership' and exposes the organizationId field", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/membership.ts"));
    expect(mod.membership.name).toBe("Membership");
    expect(Object.keys(mod.membership.fields)).toContain("organizationId");
  });

  test("organizationId is a uuid field that points at the Organization type", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/membership.ts"));
    const field = mod.membership.fields.organizationId;
    expect(field.type).toBe("uuid");
    expect(field.rawRelation).toBeDefined();
    expect(field.rawRelation.toward.type).toBe("Organization");
  });

  test("the relation is many-to-one", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/membership.ts"));
    const field = mod.membership.fields.organizationId;
    expect(["n-1", "manyToOne", "N-1"]).toContain(field.rawRelation.type);
  });
});
