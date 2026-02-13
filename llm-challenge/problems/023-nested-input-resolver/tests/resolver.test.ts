import { describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";

const workDir = path.resolve(import.meta.dirname, "..", "work");
const workDirExists = fs.existsSync(workDir);

describe.skipIf(!workDirExists)("023-nested-input-resolver", () => {
  const resolverPath = path.join(workDir, "resolvers/processOrder.ts");

  test("resolvers/processOrder.ts exists", () => {
    expect(fs.existsSync(resolverPath)).toBe(true);
  });

  test("has default export", async () => {
    const mod = await import(resolverPath);
    expect(mod.default).toBeDefined();
  });

  test("resolver name is 'processOrder'", async () => {
    const mod = await import(resolverPath);
    const resolver = mod.default;
    expect(resolver.name).toBe("processOrder");
  });

  test("operation is 'mutation'", async () => {
    const mod = await import(resolverPath);
    const resolver = mod.default;
    expect(resolver.operation).toBe("mutation");
  });

  test("input has customer field as nested object", async () => {
    const mod = await import(resolverPath);
    const resolver = mod.default;
    expect(resolver.input.customer).toBeDefined();
    expect(resolver.input.customer.type).toBe("nested");
    expect(resolver.input.customer.fields.name).toBeDefined();
    expect(resolver.input.customer.fields.name.type).toBe("string");
    expect(resolver.input.customer.fields.email).toBeDefined();
    expect(resolver.input.customer.fields.email.type).toBe("string");
  });

  test("input has items field as array of nested objects", async () => {
    const mod = await import(resolverPath);
    const resolver = mod.default;
    expect(resolver.input.items).toBeDefined();
    expect(resolver.input.items.type).toBe("nested");
    expect(resolver.input.items.metadata.array).toBe(true);
    expect(resolver.input.items.fields.productName).toBeDefined();
    expect(resolver.input.items.fields.productName.type).toBe("string");
    expect(resolver.input.items.fields.quantity).toBeDefined();
    expect(resolver.input.items.fields.quantity.type).toBe("integer");
    expect(resolver.input.items.fields.unitPrice).toBeDefined();
    expect(resolver.input.items.fields.unitPrice.type).toBe("float");
  });

  test("input has discountType as enum", async () => {
    const mod = await import(resolverPath);
    const resolver = mod.default;
    expect(resolver.input.discountType).toBeDefined();
    expect(resolver.input.discountType.type).toBe("enum");
  });

  test("input has discountValue as optional float", async () => {
    const mod = await import(resolverPath);
    const resolver = mod.default;
    expect(resolver.input.discountValue).toBeDefined();
    expect(resolver.input.discountValue.type).toBe("float");
    expect(resolver.input.discountValue.metadata.required).toBe(false);
  });

  test("body computes correctly with percentage discount", async () => {
    const mod = await import(resolverPath);
    const resolver = mod.default;
    const result = resolver.body({
      input: {
        customer: { name: "Alice", email: "alice@example.com" },
        items: [
          { productName: "Widget", quantity: 2, unitPrice: 10.0 },
          { productName: "Gadget", quantity: 1, unitPrice: 25.5 },
        ],
        discountType: "percentage",
        discountValue: 10,
      },
      user: {},
      env: {},
    });
    expect(result.customerName).toBe("Alice");
    expect(result.subtotal).toBe(45.5);
    expect(result.total).toBeCloseTo(40.95);
    expect(result.itemCount).toBe(3);
  });

  test("body computes correctly with fixed discount", async () => {
    const mod = await import(resolverPath);
    const resolver = mod.default;
    const result = resolver.body({
      input: {
        customer: { name: "Bob", email: "bob@example.com" },
        items: [{ productName: "A", quantity: 1, unitPrice: 100 }],
        discountType: "fixed",
        discountValue: 15,
      },
      user: {},
      env: {},
    });
    expect(result.subtotal).toBe(100);
    expect(result.total).toBe(85);
    expect(result.itemCount).toBe(1);
  });

  test("body computes correctly with no discount", async () => {
    const mod = await import(resolverPath);
    const resolver = mod.default;
    const result = resolver.body({
      input: {
        customer: { name: "Carol", email: "carol@example.com" },
        items: [{ productName: "A", quantity: 3, unitPrice: 20 }],
        discountType: "none",
      },
      user: {},
      env: {},
    });
    expect(result.subtotal).toBe(60);
    expect(result.total).toBe(60);
    expect(result.itemCount).toBe(3);
  });

  test("body clamps total to 0 when discount exceeds subtotal", async () => {
    const mod = await import(resolverPath);
    const resolver = mod.default;
    const result = resolver.body({
      input: {
        customer: { name: "Dave", email: "dave@example.com" },
        items: [{ productName: "A", quantity: 1, unitPrice: 10 }],
        discountType: "fixed",
        discountValue: 50,
      },
      user: {},
      env: {},
    });
    expect(result.total).toBe(0);
  });

  test("output has correct fields", async () => {
    const mod = await import(resolverPath);
    const resolver = mod.default;
    expect(resolver.output).toBeDefined();
    expect(resolver.output.type).toBe("nested");
    expect(resolver.output.fields).toBeDefined();
    expect(resolver.output.fields.customerName).toBeDefined();
    expect(resolver.output.fields.customerName.type).toBe("string");
    expect(resolver.output.fields.subtotal).toBeDefined();
    expect(resolver.output.fields.subtotal.type).toBe("float");
    expect(resolver.output.fields.total).toBeDefined();
    expect(resolver.output.fields.total.type).toBe("float");
    expect(resolver.output.fields.itemCount).toBeDefined();
    expect(resolver.output.fields.itemCount.type).toBe("integer");
  });
});
