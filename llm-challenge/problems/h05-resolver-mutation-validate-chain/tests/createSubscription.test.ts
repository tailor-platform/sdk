import path from "node:path";
import { describe, expect, test } from "vitest";
import { createWorkDirContext, importPath } from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("h05-resolver-mutation-validate-chain", () => {
  test("subscription model exposes plan + price fields with type-level validators", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/subscription.ts"));
    expect(mod.subscription.name).toBe("Subscription");
    expect(Object.keys(mod.subscription.fields)).toEqual(expect.arrayContaining(["plan", "price"]));
    expect(mod.subscription.fields.plan.type).toBe("string");
    expect(mod.subscription.fields.price.type).toBe("float");

    const planOk = mod.subscription.fields.plan.parse({
      value: "pro",
      data: {},
      user: {},
    });
    expect(planOk.issues).toBeUndefined();

    const planBad = mod.subscription.fields.plan.parse({
      value: "platinum",
      data: {},
      user: {},
    });
    const planMessages = (planBad.issues ?? []).map((i: { message: string }) => i.message);
    expect(planMessages).toContain("plan not allowed");

    const priceBad = mod.subscription.fields.price.parse({
      value: -1,
      data: {},
      user: {},
    });
    const priceMessages = (priceBad.issues ?? []).map((i: { message: string }) => i.message);
    expect(priceMessages).toContain("price must be >= 0");
  });

  test("createSubscription resolver exposes the expected operation shape", async () => {
    const mod = await importPath(path.join(workDir, "resolvers/createSubscription.ts"));
    expect(mod.default.name).toBe("createSubscription");
    expect(mod.default.operation).toBe("mutation");
    expect(mod.default.input).toBeDefined();
    expect(mod.default.input.plan.type).toBe("string");
    expect(mod.default.input.price.type).toBe("float");
    // output is normalized to a nested t.object — fields live under .fields.
    const outputFields = mod.default.output.fields;
    expect(outputFields.success.type).toBe("boolean");
    expect(outputFields.errors.type).toBe("string");
    expect(outputFields.errors.metadata.array).toBe(true);
  });

  test("valid input returns success=true with no errors", async () => {
    const mod = await importPath(path.join(workDir, "resolvers/createSubscription.ts"));
    const result = await mod.default.body({
      input: { plan: "pro", price: 49.0 },
      user: {},
      env: {},
    });
    expect(result).toEqual({ success: true, errors: [] });
  });

  test("invalid plan surfaces the configured validator message", async () => {
    const mod = await importPath(path.join(workDir, "resolvers/createSubscription.ts"));
    const result = await mod.default.body({
      input: { plan: "platinum", price: 12 },
      user: {},
      env: {},
    });
    expect(result.success).toBe(false);
    expect(result.errors).toContain("plan not allowed");
    expect(result.errors).not.toContain("price must be >= 0");
  });

  test("invalid price surfaces only the price validator message", async () => {
    const mod = await importPath(path.join(workDir, "resolvers/createSubscription.ts"));
    const result = await mod.default.body({
      input: { plan: "basic", price: -5 },
      user: {},
      env: {},
    });
    expect(result.success).toBe(false);
    expect(result.errors).toContain("price must be >= 0");
    expect(result.errors).not.toContain("plan not allowed");
  });

  test("both invalid → both messages appear in plan-then-price order", async () => {
    const mod = await importPath(path.join(workDir, "resolvers/createSubscription.ts"));
    const result = await mod.default.body({
      input: { plan: "platinum", price: -1 },
      user: {},
      env: {},
    });
    expect(result.success).toBe(false);
    expect(result.errors).toEqual(["plan not allowed", "price must be >= 0"]);
  });
});
