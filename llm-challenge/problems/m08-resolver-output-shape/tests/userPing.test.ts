import path from "node:path";
import { describe, expect, test } from "vitest";
import { createWorkDirContext, importPath } from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("m08-resolver-output-shape", () => {
  test("resolver is default exported and named 'userPing' as a query", async () => {
    const mod = await importPath(path.join(workDir, "resolvers/userPing.ts"));
    const resolver = mod.default;
    expect(resolver).toBeDefined();
    expect(resolver.name).toBe("userPing");
    expect(resolver.operation).toBe("query");
  });

  test("output is a nested object with an ok boolean field", async () => {
    const mod = await importPath(path.join(workDir, "resolvers/userPing.ts"));
    const resolver = mod.default;
    expect(resolver.output.type).toBe("nested");
    expect(resolver.output.fields.ok.type).toBe("boolean");
  });

  test("body returns { ok: true }", async () => {
    const mod = await importPath(path.join(workDir, "resolvers/userPing.ts"));
    const result = await mod.default.body({ user: {}, env: {} });
    expect(result).toEqual({ ok: true });
  });
});
