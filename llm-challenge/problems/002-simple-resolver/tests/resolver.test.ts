import { describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";

describe("002-simple-resolver", () => {
  const workDir = path.resolve(import.meta.dirname, "..", "work");

  test("resolvers/calculator.ts exists", () => {
    expect(fs.existsSync(path.join(workDir, "resolvers/calculator.ts"))).toBe(true);
  });

  test("resolver has correct name", async () => {
    const mod = await import(path.join(workDir, "resolvers/calculator.ts"));
    const resolver = mod.default;
    expect(resolver).toBeDefined();
    expect(resolver.name).toBe("calculator");
  });

  test("resolver has correct operation", async () => {
    const mod = await import(path.join(workDir, "resolvers/calculator.ts"));
    const resolver = mod.default;
    expect(resolver.operation).toBe("query");
  });

  test("resolver has input fields a and b", async () => {
    const mod = await import(path.join(workDir, "resolvers/calculator.ts"));
    const resolver = mod.default;
    expect(resolver.input).toBeDefined();
    expect(resolver.input.a).toBeDefined();
    expect(resolver.input.b).toBeDefined();
    expect(resolver.input.a.type).toBe("integer");
    expect(resolver.input.b.type).toBe("integer");
  });

  test("resolver body computes sum and product correctly", async () => {
    const mod = await import(path.join(workDir, "resolvers/calculator.ts"));
    const resolver = mod.default;
    expect(typeof resolver.body).toBe("function");

    const result = resolver.body({ input: { a: 3, b: 4 }, user: {}, env: {} });
    expect(result).toEqual({ sum: 7, product: 12 });
  });

  test("resolver body handles zero values", async () => {
    const mod = await import(path.join(workDir, "resolvers/calculator.ts"));
    const resolver = mod.default;

    const result = resolver.body({ input: { a: 0, b: 5 }, user: {}, env: {} });
    expect(result).toEqual({ sum: 5, product: 0 });
  });

  test("resolver body handles negative values", async () => {
    const mod = await import(path.join(workDir, "resolvers/calculator.ts"));
    const resolver = mod.default;

    const result = resolver.body({ input: { a: -3, b: 7 }, user: {}, env: {} });
    expect(result).toEqual({ sum: 4, product: -21 });
  });

  test("resolver output has sum and product fields", async () => {
    const mod = await import(path.join(workDir, "resolvers/calculator.ts"));
    const resolver = mod.default;
    expect(resolver.output).toBeDefined();
    expect(resolver.output.type).toBe("nested");
    expect(resolver.output.fields).toBeDefined();
    expect(resolver.output.fields.sum).toBeDefined();
    expect(resolver.output.fields.sum.type).toBe("integer");
    expect(resolver.output.fields.product).toBeDefined();
    expect(resolver.output.fields.product.type).toBe("integer");
  });
});
