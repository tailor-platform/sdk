import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  createWorkDirContext,
  expectEnumValues,
  importPath,
} from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("011-fix-broken-resolver", () => {
  const resolverPath = path.join(workDir, "resolvers/calculateDiscount/resolver.ts");

  test("resolvers/calculateDiscount/resolver.ts exists", () => {
    expect(fs.existsSync(resolverPath)).toBe(true);
  });

  test("resolver is a default export", async () => {
    const mod = await importPath(resolverPath);
    expect(mod.default).toBeDefined();
  });

  test("resolver name is 'calculateDiscount' (camelCase)", async () => {
    const { default: resolver } = await importPath(resolverPath);
    expect(resolver.name).toBe("calculateDiscount");
  });

  test("resolver operation is 'query'", async () => {
    const { default: resolver } = await importPath(resolverPath);
    expect(resolver.operation).toBe("query");
  });

  test("input has price, discountPercent, and membershipLevel", async () => {
    const { default: resolver } = await importPath(resolverPath);
    expect(resolver.input.price).toBeDefined();
    expect(resolver.input.discountPercent).toBeDefined();
    expect(resolver.input.membershipLevel).toBeDefined();
  });

  test("membershipLevel is enum with correct values", async () => {
    const { default: resolver } = await importPath(resolverPath);
    expectEnumValues(resolver.input.membershipLevel, ["gold", "silver", "bronze"]);
  });

  test("output is wrapped with t.object (type is 'nested')", async () => {
    const { default: resolver } = await importPath(resolverPath);
    expect(resolver.output).toBeDefined();
    expect(resolver.output.type).toBe("nested");
    expect(resolver.output.fields).toBeDefined();
    expect(resolver.output.fields.originalPrice).toBeDefined();
    expect(resolver.output.fields.discountAmount).toBeDefined();
    expect(resolver.output.fields.bonusPercent).toBeDefined();
    expect(resolver.output.fields.finalPrice).toBeDefined();
  });

  test("body is a callable function", async () => {
    const { default: resolver } = await importPath(resolverPath);
    expect(typeof resolver.body).toBe("function");
  });

  test("body calculates gold membership correctly (100, 20%)", async () => {
    const { default: resolver } = await importPath(resolverPath);
    const result = resolver.body({
      input: { price: 100, discountPercent: 20, membershipLevel: "gold" },
      user: {},
    });
    expect(result.originalPrice).toBe(100);
    expect(result.discountAmount).toBe(20);
    expect(result.bonusPercent).toBe(5);
    expect(result.finalPrice).toBeCloseTo(76, 5);
  });

  test("body calculates bronze membership correctly (no bonus)", async () => {
    const { default: resolver } = await importPath(resolverPath);
    const result = resolver.body({
      input: { price: 200, discountPercent: 10, membershipLevel: "bronze" },
      user: {},
    });
    expect(result.originalPrice).toBe(200);
    expect(result.discountAmount).toBe(20);
    expect(result.bonusPercent).toBe(0);
    expect(result.finalPrice).toBe(180);
  });

  test("body clamps finalPrice to 0 for excessive discount", async () => {
    const { default: resolver } = await importPath(resolverPath);
    const result = resolver.body({
      input: { price: 100, discountPercent: 150, membershipLevel: "gold" },
      user: {},
    });
    expect(result.originalPrice).toBe(100);
    expect(result.finalPrice).toBe(0);
  });

  test("body calculates silver membership correctly", async () => {
    const { default: resolver } = await importPath(resolverPath);
    const result = resolver.body({
      input: { price: 100, discountPercent: 0, membershipLevel: "silver" },
      user: {},
    });
    expect(result.originalPrice).toBe(100);
    expect(result.discountAmount).toBe(0);
    expect(result.bonusPercent).toBe(3);
    expect(result.finalPrice).toBeCloseTo(97, 5);
  });
});
