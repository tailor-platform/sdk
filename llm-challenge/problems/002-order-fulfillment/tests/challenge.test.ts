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

// Extract the validate function from metadata.validate which may be stored as:
// - a bare function
// - an array of functions [fn]
// - an array of tuples [[fn, "message"]]
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
function extractValidateFn(validate: any): (input: any) => boolean {
  if (typeof validate === "function") return validate;
  const first = validate[0];
  if (typeof first === "function") return first;
  if (Array.isArray(first) && typeof first[0] === "function") return first[0];
  throw new Error("Could not extract validate function");
}

describe.skipIf(!workDirReady)("002-order-fulfillment", () => {
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

    test("email create hook lowercases value", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/customer.ts"));
      const hook = mod.customer.fields.email.metadata.hooks?.create;
      expect(hook).toBeDefined();
      expect(hook({ value: "HELLO@Example.COM", data: {}, user: {} })).toBe("hello@example.com");
    });

    test("email create hook treats non-string as empty string", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/customer.ts"));
      const hook = mod.customer.fields.email.metadata.hooks?.create;
      expect(hook({ value: null, data: {}, user: {} })).toBe("");
    });

    test("loyaltyTier create hook defaults to BRONZE when nullish", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/customer.ts"));
      const hook = mod.customer.fields.loyaltyTier.metadata.hooks?.create;
      expect(hook).toBeDefined();
      expect(hook({ value: undefined, data: {}, user: {} })).toBe("BRONZE");
      expect(hook({ value: null, data: {}, user: {} })).toBe("BRONZE");
    });

    test("loyaltyTier create hook preserves provided value", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/customer.ts"));
      const hook = mod.customer.fields.loyaltyTier.metadata.hooks?.create;
      expect(hook({ value: "GOLD", data: {}, user: {} })).toBe("GOLD");
    });

    test("email validate accepts valid address", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/customer.ts"));
      const fn = extractValidateFn(mod.customer.fields.email.metadata.validate);
      expect(fn({ value: "alice@example.com", data: {}, user: {} })).toBe(true);
    });

    test("email validate rejects malformed address", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/customer.ts"));
      const fn = extractValidateFn(mod.customer.fields.email.metadata.validate);
      expect(fn({ value: "not-an-email", data: {}, user: {} })).toBe(false);
      expect(fn({ value: "missing@domain", data: {}, user: {} })).toBe(false);
    });

    test("displayName validate accepts length 80", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/customer.ts"));
      const fn = extractValidateFn(mod.customer.fields.displayName.metadata.validate);
      expect(fn({ value: "a".repeat(80), data: {}, user: {} })).toBe(true);
    });

    test("displayName validate rejects length 81", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/customer.ts"));
      const fn = extractValidateFn(mod.customer.fields.displayName.metadata.validate);
      expect(fn({ value: "a".repeat(81), data: {}, user: {} })).toBe(false);
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

    test("status create hook defaults to PLACED when nullish", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/order.ts"));
      const hook = mod.order.fields.status.metadata.hooks?.create;
      expect(hook).toBeDefined();
      expect(hook({ value: undefined, data: {}, user: {} })).toBe("PLACED");
      expect(hook({ value: null, data: {}, user: {} })).toBe("PLACED");
    });

    test("status create hook preserves provided value", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/order.ts"));
      const hook = mod.order.fields.status.metadata.hooks?.create;
      expect(hook({ value: "PAID", data: {}, user: {} })).toBe("PAID");
    });

    test("totalAmount validate accepts 0", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/order.ts"));
      const fn = extractValidateFn(mod.order.fields.totalAmount.metadata.validate);
      expect(fn({ value: 0, data: {}, user: {} })).toBe(true);
    });

    test("totalAmount validate rejects negative", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/order.ts"));
      const fn = extractValidateFn(mod.order.fields.totalAmount.metadata.validate);
      expect(fn({ value: -0.01, data: {}, user: {} })).toBe(false);
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

    test("quantity validate accepts 1", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/orderItem.ts"));
      const fn = extractValidateFn(mod.orderItem.fields.quantity.metadata.validate);
      expect(fn({ value: 1, data: {}, user: {} })).toBe(true);
    });

    test("quantity validate rejects 0", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/orderItem.ts"));
      const fn = extractValidateFn(mod.orderItem.fields.quantity.metadata.validate);
      expect(fn({ value: 0, data: {}, user: {} })).toBe(false);
    });

    test("unitPrice validate accepts 0", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/orderItem.ts"));
      const fn = extractValidateFn(mod.orderItem.fields.unitPrice.metadata.validate);
      expect(fn({ value: 0, data: {}, user: {} })).toBe(true);
    });

    test("unitPrice validate rejects negative", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/orderItem.ts"));
      const fn = extractValidateFn(mod.orderItem.fields.unitPrice.metadata.validate);
      expect(fn({ value: -1, data: {}, user: {} })).toBe(false);
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
