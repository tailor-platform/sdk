import path from "node:path";
import { describe, expect, test } from "vitest";
import { createWorkDirContext, importPath } from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("m05-db-type-hooks-create", () => {
  test("account model is named 'Account' and exposes the slug field", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/account.ts"));
    expect(mod.account.name).toBe("Account");
    expect(Object.keys(mod.account.fields)).toContain("slug");
    expect(mod.account.fields.slug.type).toBe("string");
  });

  test("a create hook is attached to the slug field at the type level", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/account.ts"));
    const hooks = mod.account.fields.slug.metadata.hooks;
    expect(hooks).toBeDefined();
    expect(typeof hooks.create).toBe("function");
  });

  test("the create hook lowercases the supplied slug", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/account.ts"));
    const hook = mod.account.fields.slug.metadata.hooks.create;
    const result = hook({ value: "Acme-Inc", data: {}, user: {} });
    expect(result).toBe("acme-inc");
  });
});
