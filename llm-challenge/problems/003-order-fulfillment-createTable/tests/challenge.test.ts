import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  createWorkDirContext,
  expectEnumValues,
  expectFieldNames,
  expectFieldType,
  expectTimestamps,
  importPath,
} from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

// Run all record-level validators against a data snapshot and return their
// boolean results. Each entry may be a bare function or `[fn, message]` tuple.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
function runValidators(validators: any, data: any): boolean[] {
  const arr = Array.isArray(validators) ? validators : [validators];
  return arr.map((v) => {
    const fn = Array.isArray(v) ? v[0] : v;
    return fn({ data, user: {} });
  });
}

describe.skipIf(!workDirReady)("003-order-fulfillment-createTable", () => {
  // ---------------------------------------------------------------------------
  // Customer
  // ---------------------------------------------------------------------------
  describe("Customer model", () => {
    test("model name is Customer", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/customer.ts"));
      expect(mod.customer.name).toBe("Customer");
    });

    test("has correct field names", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/customer.ts"));
      expectFieldNames(mod.customer, [
        "email",
        "displayName",
        "loyaltyTier",
        "createdAt",
        "updatedAt",
      ]);
    });

    test("email is string required and unique", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/customer.ts"));
      expectFieldType(mod.customer.fields.email, "string", { required: true, unique: true });
    });

    test("displayName is string required", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/customer.ts"));
      expectFieldType(mod.customer.fields.displayName, "string", { required: true });
    });

    test("loyaltyTier is enum with correct values and optional", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/customer.ts"));
      expectEnumValues(mod.customer.fields.loyaltyTier, ["BRONZE", "SILVER", "GOLD"]);
      expect(mod.customer.fields.loyaltyTier.metadata.required).toBe(false);
    });

    test("has timestamps", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/customer.ts"));
      expectTimestamps(mod.customer);
    });

    test("record-level create hook lowercases email", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/customer.ts"));
      const hook = mod.customer.metadata.hooks?.create;
      expect(hook).toBeDefined();
      const out = hook({
        data: { email: "HELLO@Example.COM", displayName: "Alice" },
        user: {},
      });
      expect(out.email).toBe("hello@example.com");
    });

    test("record-level create hook treats non-string email as empty string", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/customer.ts"));
      const hook = mod.customer.metadata.hooks?.create;
      const out = hook({ data: { email: null, displayName: "Alice" }, user: {} });
      expect(out.email).toBe("");
    });

    test("record-level create hook defaults loyaltyTier to BRONZE when nullish", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/customer.ts"));
      const hook = mod.customer.metadata.hooks?.create;
      const out1 = hook({
        data: { email: "a@b.co", displayName: "Alice", loyaltyTier: undefined },
        user: {},
      });
      expect(out1.loyaltyTier).toBe("BRONZE");
      const out2 = hook({
        data: { email: "a@b.co", displayName: "Alice", loyaltyTier: null },
        user: {},
      });
      expect(out2.loyaltyTier).toBe("BRONZE");
    });

    test("record-level create hook preserves provided loyaltyTier", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/customer.ts"));
      const hook = mod.customer.metadata.hooks?.create;
      const out = hook({
        data: { email: "a@b.co", displayName: "Alice", loyaltyTier: "GOLD" },
        user: {},
      });
      expect(out.loyaltyTier).toBe("GOLD");
    });

    test("record-level validators accept a valid record", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/customer.ts"));
      const results = runValidators(mod.customer.metadata.validate, {
        email: "alice@example.com",
        displayName: "Alice",
      });
      expect(results.every((r) => r === true)).toBe(true);
    });

    test("record-level validators reject malformed email", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/customer.ts"));
      const r1 = runValidators(mod.customer.metadata.validate, {
        email: "not-an-email",
        displayName: "Alice",
      });
      expect(r1.some((r) => r === false)).toBe(true);
      const r2 = runValidators(mod.customer.metadata.validate, {
        email: "missing@domain",
        displayName: "Alice",
      });
      expect(r2.some((r) => r === false)).toBe(true);
    });

    test("record-level validators accept displayName of length 80", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/customer.ts"));
      const results = runValidators(mod.customer.metadata.validate, {
        email: "alice@example.com",
        displayName: "a".repeat(80),
      });
      expect(results.every((r) => r === true)).toBe(true);
    });

    test("record-level validators reject displayName of length 81", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/customer.ts"));
      const results = runValidators(mod.customer.metadata.validate, {
        email: "alice@example.com",
        displayName: "a".repeat(81),
      });
      expect(results.some((r) => r === false)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Order
  // ---------------------------------------------------------------------------
  describe("Order model", () => {
    test("model name is Order", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/order.ts"));
      expect(mod.order.name).toBe("Order");
    });

    test("has correct field names", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/order.ts"));
      expectFieldNames(mod.order, [
        "customerId",
        "status",
        "orderCode",
        "totalAmount",
        "createdAt",
        "updatedAt",
      ]);
    });

    test("customerId has n-1 relation to Customer", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/order.ts"));
      const field = mod.order.fields.customerId;
      expect(field.type).toBe("uuid");
      expect(field.rawRelation).toBeDefined();
      expect(field.rawRelation.type).toBe("n-1");
      expect(field.rawRelation.toward.type).toBe("Customer");
    });

    test("status is enum with correct values and optional", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/order.ts"));
      expectEnumValues(mod.order.fields.status, ["PLACED", "PAID", "SHIPPED", "CANCELLED"]);
      expect(mod.order.fields.status.metadata.required).toBe(false);
    });

    test("orderCode is string with serial config ORD-%05d", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/order.ts"));
      const field = mod.order.fields.orderCode;
      expect(field.type).toBe("string");
      expect(field.metadata.serial).toBeDefined();
      expect(field.metadata.serial.format).toBe("ORD-%05d");
    });

    test("totalAmount is float required", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/order.ts"));
      expectFieldType(mod.order.fields.totalAmount, "float", { required: true });
    });

    test("has timestamps", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/order.ts"));
      expectTimestamps(mod.order);
    });

    test("record-level create hook defaults status to PLACED when nullish", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/order.ts"));
      const hook = mod.order.metadata.hooks?.create;
      expect(hook).toBeDefined();
      const out1 = hook({
        data: { customerId: "u", totalAmount: 10, status: undefined },
        user: {},
      });
      expect(out1.status).toBe("PLACED");
      const out2 = hook({
        data: { customerId: "u", totalAmount: 10, status: null },
        user: {},
      });
      expect(out2.status).toBe("PLACED");
    });

    test("record-level create hook preserves provided status", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/order.ts"));
      const hook = mod.order.metadata.hooks?.create;
      const out = hook({
        data: { customerId: "u", totalAmount: 10, status: "PAID" },
        user: {},
      });
      expect(out.status).toBe("PAID");
    });

    test("record-level validators accept totalAmount 0", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/order.ts"));
      const results = runValidators(mod.order.metadata.validate, {
        customerId: "u",
        totalAmount: 0,
      });
      expect(results.every((r) => r === true)).toBe(true);
    });

    test("record-level validators reject negative totalAmount", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/order.ts"));
      const results = runValidators(mod.order.metadata.validate, {
        customerId: "u",
        totalAmount: -0.01,
      });
      expect(results.some((r) => r === false)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // OrderItem
  // ---------------------------------------------------------------------------
  describe("OrderItem model", () => {
    test("model name is OrderItem", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/orderItem.ts"));
      expect(mod.orderItem.name).toBe("OrderItem");
    });

    test("has correct field names", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/orderItem.ts"));
      expectFieldNames(mod.orderItem, [
        "orderId",
        "sku",
        "unitPrice",
        "quantity",
        "createdAt",
        "updatedAt",
      ]);
    });

    test("orderId has n-1 relation to Order", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/orderItem.ts"));
      const field = mod.orderItem.fields.orderId;
      expect(field.type).toBe("uuid");
      expect(field.rawRelation).toBeDefined();
      expect(field.rawRelation.type).toBe("n-1");
      expect(field.rawRelation.toward.type).toBe("Order");
    });

    test("sku is string required", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/orderItem.ts"));
      expectFieldType(mod.orderItem.fields.sku, "string", { required: true });
    });

    test("unitPrice is float required", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/orderItem.ts"));
      expectFieldType(mod.orderItem.fields.unitPrice, "float", { required: true });
    });

    test("quantity is integer required", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/orderItem.ts"));
      expectFieldType(mod.orderItem.fields.quantity, "integer", { required: true });
    });

    test("has timestamps", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/orderItem.ts"));
      expectTimestamps(mod.orderItem);
    });

    test("record-level validators accept quantity 1", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/orderItem.ts"));
      const results = runValidators(mod.orderItem.metadata.validate, {
        orderId: "o",
        sku: "X",
        unitPrice: 1,
        quantity: 1,
      });
      expect(results.every((r) => r === true)).toBe(true);
    });

    test("record-level validators reject quantity 0", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/orderItem.ts"));
      const results = runValidators(mod.orderItem.metadata.validate, {
        orderId: "o",
        sku: "X",
        unitPrice: 1,
        quantity: 0,
      });
      expect(results.some((r) => r === false)).toBe(true);
    });

    test("record-level validators accept unitPrice 0", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/orderItem.ts"));
      const results = runValidators(mod.orderItem.metadata.validate, {
        orderId: "o",
        sku: "X",
        unitPrice: 0,
        quantity: 1,
      });
      expect(results.every((r) => r === true)).toBe(true);
    });

    test("record-level validators reject unitPrice -1 AND quantity 0 (both validators present)", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/orderItem.ts"));
      const results = runValidators(mod.orderItem.metadata.validate, {
        orderId: "o",
        sku: "X",
        unitPrice: -1,
        quantity: 0,
      });
      // Both validators must reject this record
      expect(results.filter((r) => r === false).length).toBeGreaterThanOrEqual(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Shipment
  // ---------------------------------------------------------------------------
  describe("Shipment model", () => {
    test("model name is Shipment", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/shipment.ts"));
      expect(mod.shipment.name).toBe("Shipment");
    });

    test("has correct field names", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/shipment.ts"));
      expectFieldNames(mod.shipment, [
        "orderId",
        "trackingNumber",
        "shippedAt",
        "createdAt",
        "updatedAt",
      ]);
    });

    test("orderId has n-1 relation to Order", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/shipment.ts"));
      const field = mod.shipment.fields.orderId;
      expect(field.type).toBe("uuid");
      expect(field.rawRelation).toBeDefined();
      expect(field.rawRelation.type).toBe("n-1");
      expect(field.rawRelation.toward.type).toBe("Order");
    });

    test("trackingNumber is string required and unique", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/shipment.ts"));
      expectFieldType(mod.shipment.fields.trackingNumber, "string", {
        required: true,
        unique: true,
      });
    });

    test("shippedAt is datetime required", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/shipment.ts"));
      expectFieldType(mod.shipment.fields.shippedAt, "datetime", { required: true });
    });

    test("has timestamps", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/shipment.ts"));
      expectTimestamps(mod.shipment);
    });

    test("has record-level permission with all 4 actions", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/shipment.ts"));
      const permission = mod.shipment.metadata.permissions?.record;
      expect(permission).toBeDefined();
      expect(permission.create).toBeDefined();
      expect(permission.read).toBeDefined();
      expect(permission.update).toBeDefined();
      expect(permission.delete).toBeDefined();
    });
  });
});
