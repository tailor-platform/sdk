import path from "node:path";
import { describe, expect, test } from "vitest";
import { createWorkDirContext, importPath } from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("m23-cli-implicit-any-fix", () => {
  test("resolver exports name 'lookup-role' as a query and declares a userId input", async () => {
    const mod = await importPath(path.join(workDir, "resolvers/lookupRole.ts"));
    expect(mod.default.name).toBe("lookup-role");
    expect(mod.default.operation).toBe("query");
    expect(mod.default.input).toBeDefined();
    expect(mod.default.input.userId).toBeDefined();
    expect(mod.default.input.userId.type).toBe("string");
  });

  test("body returns a role string derived from input.userId", async () => {
    const mod = await importPath(path.join(workDir, "resolvers/lookupRole.ts"));
    const ctx = { input: { userId: "u-1" }, user: {}, env: {} };
    const result = await mod.default.body(ctx);
    expect(result.role).toBe("role-for-u-1");
  });
});
