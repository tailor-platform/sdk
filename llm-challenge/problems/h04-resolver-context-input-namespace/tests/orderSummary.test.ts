import path from "node:path";
import { describe, expect, test } from "vitest";
import { createWorkDirContext, importPath } from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("h04-resolver-context-input-namespace", () => {
  test("resolver is default-exported and named 'orderSummary' as a query", async () => {
    const mod = await importPath(path.join(workDir, "resolvers/orderSummary.ts"));
    const resolver = mod.default;
    expect(resolver).toBeDefined();
    expect(resolver.name).toBe("orderSummary");
    expect(resolver.operation).toBe("query");
  });

  test("input declares a string orderId field", async () => {
    const mod = await importPath(path.join(workDir, "resolvers/orderSummary.ts"));
    const resolver = mod.default;
    expect(resolver.input).toBeDefined();
    expect(resolver.input.orderId).toBeDefined();
    expect(resolver.input.orderId.type).toBe("string");
  });

  test("body is a single-argument function (not positional input)", async () => {
    const mod = await importPath(path.join(workDir, "resolvers/orderSummary.ts"));
    const resolver = mod.default;
    expect(typeof resolver.body).toBe("function");
    // Resolver bodies receive a single context object; a body declared as
    // (ctx, input) => ... would report length=2.
    expect(resolver.body.length).toBe(1);
  });

  test("body projects input.orderId and user.id into the output", async () => {
    const mod = await importPath(path.join(workDir, "resolvers/orderSummary.ts"));
    const result = await mod.default.body({
      input: { orderId: "ord-123" },
      user: { id: "user-42" },
      env: {},
    });
    expect(result).toEqual({ orderId: "ord-123", viewerId: "user-42" });
  });
});
