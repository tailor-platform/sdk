import { describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { importPath } from "../../../shared/helpers.js";

const workDir = path.resolve(import.meta.dirname, "..", "work");
const workDirReady = fs.existsSync(path.join(workDir, "node_modules"));

describe.skipIf(!workDirReady)("004-db-resolvers-with-workflow", () => {
  // ─── getUser ──────────────────────────────────────────────────────────

  describe("getUser resolver", () => {
    const resolverPath = path.join(workDir, "resolvers/getUser.ts");

    test("has default export with correct name and operation", async () => {
      const mod = await importPath(resolverPath);
      const resolver = mod.default;
      expect(resolver).toBeDefined();
      expect(resolver.name).toBe("getUser");
      expect(resolver.operation).toBe("query");
    });

    test("input has id field as string", async () => {
      const { default: resolver } = await importPath(resolverPath);
      expect(resolver.input).toBeDefined();
      expect(resolver.input.id).toBeDefined();
      expect(resolver.input.id.type).toBe("string");
    });

    test("body is an async function", async () => {
      const { default: resolver } = await importPath(resolverPath);
      expect(typeof resolver.body).toBe("function");
      // Check that it's async (constructor name is AsyncFunction)
      expect(resolver.body.constructor.name).toBe("AsyncFunction");
    });

    test("output has name and email fields", async () => {
      const { default: resolver } = await importPath(resolverPath);
      expect(resolver.output).toBeDefined();
      expect(resolver.output.type).toBe("nested");
      expect(resolver.output.fields.name).toBeDefined();
      expect(resolver.output.fields.name.type).toBe("string");
      expect(resolver.output.fields.email).toBeDefined();
      expect(resolver.output.fields.email.type).toBe("string");
    });
  });

  // ─── processOrder ────────────────────────────────────────────────────

  describe("processOrder resolver", () => {
    const resolverPath = path.join(workDir, "resolvers/processOrder.ts");

    test("has default export with correct name and operation", async () => {
      const mod = await importPath(resolverPath);
      const resolver = mod.default;
      expect(resolver).toBeDefined();
      expect(resolver.name).toBe("processOrder");
      expect(resolver.operation).toBe("mutation");
    });

    test("input has customer as nested object", async () => {
      const { default: resolver } = await importPath(resolverPath);
      expect(resolver.input.customer).toBeDefined();
      expect(resolver.input.customer.type).toBe("nested");
      expect(resolver.input.customer.fields.name.type).toBe("string");
      expect(resolver.input.customer.fields.email.type).toBe("string");
    });

    test("input has items as array of nested objects", async () => {
      const { default: resolver } = await importPath(resolverPath);
      expect(resolver.input.items).toBeDefined();
      expect(resolver.input.items.type).toBe("nested");
      expect(resolver.input.items.metadata.array).toBe(true);
      expect(resolver.input.items.fields.productName.type).toBe("string");
      expect(resolver.input.items.fields.quantity.type).toBe("integer");
      expect(resolver.input.items.fields.unitPrice.type).toBe("float");
    });

    test("input has discountType as enum and discountValue as optional float", async () => {
      const { default: resolver } = await importPath(resolverPath);
      expect(resolver.input.discountType.type).toBe("enum");
      expect(resolver.input.discountValue.type).toBe("float");
      expect(resolver.input.discountValue.metadata.required).toBe(false);
    });

    test("body computes correctly with percentage discount", async () => {
      const { default: resolver } = await importPath(resolverPath);
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
      const { default: resolver } = await importPath(resolverPath);
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
      const { default: resolver } = await importPath(resolverPath);
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
      const { default: resolver } = await importPath(resolverPath);
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

    test("body handles multiple items summing quantities", async () => {
      const { default: resolver } = await importPath(resolverPath);
      const result = resolver.body({
        input: {
          customer: { name: "Eve", email: "eve@example.com" },
          items: [
            { productName: "A", quantity: 2, unitPrice: 5 },
            { productName: "B", quantity: 3, unitPrice: 10 },
          ],
          discountType: "none",
        },
        user: {},
        env: {},
      });
      expect(result.subtotal).toBe(40);
      expect(result.total).toBe(40);
      expect(result.itemCount).toBe(5);
    });

    test("output has correct field types", async () => {
      const { default: resolver } = await importPath(resolverPath);
      expect(resolver.output.type).toBe("nested");
      expect(resolver.output.fields.customerName.type).toBe("string");
      expect(resolver.output.fields.subtotal.type).toBe("float");
      expect(resolver.output.fields.total.type).toBe("float");
      expect(resolver.output.fields.itemCount.type).toBe("integer");
    });
  });

  // ─── startProcessing ─────────────────────────────────────────────────

  describe("startProcessing resolver", () => {
    const resolverPath = path.join(workDir, "resolvers/startProcessing/resolver.ts");

    test("has default export with correct name and operation", async () => {
      const mod = await importPath(resolverPath);
      const resolver = mod.default;
      expect(resolver).toBeDefined();
      expect(resolver.name).toBe("startProcessing");
      expect(resolver.operation).toBe("mutation");
    });

    test("input has dataId as string", async () => {
      const { default: resolver } = await importPath(resolverPath);
      expect(resolver.input.dataId).toBeDefined();
      expect(resolver.input.dataId.type).toBe("string");
    });

    test("input has priority as enum with correct values", async () => {
      const { default: resolver } = await importPath(resolverPath);
      expect(resolver.input.priority).toBeDefined();
      expect(resolver.input.priority.type).toBe("enum");
      const values = resolver.input.priority.metadata.allowedValues.map(
        (v: { value: string }) => v.value,
      );
      expect(values).toEqual(["low", "medium", "high"]);
    });

    test("body returns an object with triggered: true", async () => {
      const { default: resolver } = await importPath(resolverPath);
      const result = resolver.body({
        input: { dataId: "data-1", priority: "high" },
        user: {},
        env: {},
      });
      expect(result).toBeDefined();
      expect(result.triggered).toBe(true);
    });

    test("body captures result from trigger call", async () => {
      const { default: resolver } = await importPath(resolverPath);
      const result = resolver.body({
        input: { dataId: "data-1", priority: "high" },
        user: {},
        env: {},
      });
      expect(result.result).toBeDefined();
    });

    test("output has triggered and result fields", async () => {
      const { default: resolver } = await importPath(resolverPath);
      expect(resolver.output.type).toBe("nested");
      expect(resolver.output.fields.triggered).toBeDefined();
      expect(resolver.output.fields.result).toBeDefined();
    });
  });
});
