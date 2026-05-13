import path from "node:path";
import { describe, expect, test } from "vitest";
import { createWorkDirContext, importPath } from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("m10-resolver-structured-error", () => {
  test("resolver is default exported and named 'cancel' as a mutation", async () => {
    const mod = await importPath(path.join(workDir, "resolvers/cancel.ts"));
    const resolver = mod.default;
    expect(resolver).toBeDefined();
    expect(resolver.name).toBe("cancel");
    expect(resolver.operation).toBe("mutation");
    expect(resolver.output.fields.success.type).toBe("boolean");
    expect(resolver.output.fields.error.type).toBe("string");
  });

  test("happy path returns { success: true, error: '' }", async () => {
    const mod = await importPath(path.join(workDir, "resolvers/cancel.ts"));
    const result = await mod.default.body({
      input: { id: "sub-active" },
      user: {},
      env: {},
    });
    expect(result).toEqual({ success: true, error: "" });
  });

  test("already-canceled subscription returns 'Not active'", async () => {
    const mod = await importPath(path.join(workDir, "resolvers/cancel.ts"));
    const result = await mod.default.body({
      input: { id: "sub-canceled" },
      user: {},
      env: {},
    });
    expect(result).toEqual({ success: false, error: "Not active" });
  });

  test("missing subscription returns 'Not found' without throwing", async () => {
    const mod = await importPath(path.join(workDir, "resolvers/cancel.ts"));
    const result = await mod.default.body({
      input: { id: "nope" },
      user: {},
      env: {},
    });
    expect(result).toEqual({ success: false, error: "Not found" });
  });
});
