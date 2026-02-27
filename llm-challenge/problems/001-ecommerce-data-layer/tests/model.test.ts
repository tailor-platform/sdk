import { describe, expect, test } from "vitest";
import path from "node:path";
import {
  createWorkDirContext,
  expectFieldNames,
  expectFieldType,
  expectTimestamps,
  expectEnumValues,
  importPath,
} from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("001 - E-Commerce Data Layer", () => {
  // ---------------------------------------------------------------------------
  // Customer model
  // ---------------------------------------------------------------------------
  describe("Customer model", () => {
    test("model name is Customer", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/customer.ts"));
      expect(mod.customer.name).toBe("Customer");
    });

    test("has correct field names", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/customer.ts"));
      expectFieldNames(mod.customer, [
        "name",
        "email",
        "phone",
        "address",
        "createdAt",
        "updatedAt",
      ]);
    });

    test("name is string required", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/customer.ts"));
      expectFieldType(mod.customer.fields.name, "string", { required: true });
    });

    test("email is string required", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/customer.ts"));
      expectFieldType(mod.customer.fields.email, "string", { required: true });
    });

    test("phone is string optional", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/customer.ts"));
      expectFieldType(mod.customer.fields.phone, "string", { required: false });
    });

    test("address is nested object with correct sub-fields", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/customer.ts"));
      const address = mod.customer.fields.address;
      expect(address.type).toBe("nested");
      expect(address.fields).toBeDefined();
      expect(address.fields.street.type).toBe("string");
      expect(address.fields.city.type).toBe("string");
      expect(address.fields.state.type).toBe("string");
      expect(address.fields.zipCode.type).toBe("string");
    });

    test("email validation accepts valid email and rejects invalid", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/customer.ts"));
      const validators = mod.customer.fields.email.metadata.validate;
      expect(validators).toBeDefined();
      const [validator] = validators;
      const fn = typeof validator === "function" ? validator : validator[0];
      expect(fn({ value: "test@example.com", data: {}, user: {} })).toBe(true);
      expect(fn({ value: "invalid", data: {}, user: {} })).toBe(false);
    });

    test("has timestamps", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/customer.ts"));
      expectTimestamps(mod.customer);
    });
  });

  // ---------------------------------------------------------------------------
  // Product model
  // ---------------------------------------------------------------------------
  describe("Product model", () => {
    test("model name is Product", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/product.ts"));
      expect(mod.product.name).toBe("Product");
    });

    test("has plural form ProductCatalog", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/product.ts"));
      expect(mod.product.metadata.settings?.pluralForm).toBe("ProductCatalog");
    });

    test("has correct field names", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/product.ts"));
      expectFieldNames(mod.product, [
        "name",
        "description",
        "price",
        "sku",
        "category",
        "inStock",
        "contactEmail",
        "createdAt",
        "updatedAt",
      ]);
    });

    test("price is float required and validated >= 0", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/product.ts"));
      expectFieldType(mod.product.fields.price, "float", { required: true });
      const validators = mod.product.fields.price.metadata.validate;
      expect(validators).toBeDefined();
      const [validator] = validators;
      const fn = typeof validator === "function" ? validator : validator[0];
      expect(fn({ value: -1, data: {}, user: {} })).toBe(false);
      expect(fn({ value: 0, data: {}, user: {} })).toBe(true);
      expect(fn({ value: 10, data: {}, user: {} })).toBe(true);
    });

    test("sku has serial config", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/product.ts"));
      const field = mod.product.fields.sku;
      expect(field.type).toBe("string");
      expect(field.metadata.serial).toBeDefined();
      expect(field.metadata.serial.start).toBe(1);
      expect(field.metadata.serial.format).toBe("SKU-%04d");
    });

    test("category is enum with correct values", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/product.ts"));
      expectEnumValues(mod.product.fields.category, [
        "electronics",
        "clothing",
        "food",
        "books",
        "other",
      ]);
    });

    test("inStock is bool optional", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/product.ts"));
      expectFieldType(mod.product.fields.inStock, "boolean", { required: false });
    });

    test("contactEmail create hook lowercases the value", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/product.ts"));
      const hooks = mod.product.fields.contactEmail.metadata.hooks;
      expect(hooks).toBeDefined();
      expect(hooks.create).toBeDefined();
      const result = hooks.create({
        data: { contactEmail: "TEST@EMAIL.COM" },
        value: null,
        user: {},
      });
      expect(result).toBe("test@email.com");
    });

    test("has timestamps", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/product.ts"));
      expectTimestamps(mod.product);
    });
  });

  // ---------------------------------------------------------------------------
  // Order model
  // ---------------------------------------------------------------------------
  describe("Order model", () => {
    test("model name is Order", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/order.ts"));
      expect(mod.order.name).toBe("Order");
    });

    test("has plural form OrderList", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/order.ts"));
      expect(mod.order.metadata.settings?.pluralForm).toBe("OrderList");
    });

    test("has correct field names", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/order.ts"));
      expectFieldNames(mod.order, [
        "orderNumber",
        "customerId",
        "status",
        "totalAmount",
        "notes",
        "createdAt",
        "updatedAt",
      ]);
    });

    test("orderNumber has serial config", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/order.ts"));
      const field = mod.order.fields.orderNumber;
      expect(field.type).toBe("string");
      expect(field.metadata.serial).toBeDefined();
      expect(field.metadata.serial.start).toBe(1000);
      expect(field.metadata.serial.format).toBe("ORD-%05d");
    });

    test("customerId has n-1 relation to Customer", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/order.ts"));
      const field = mod.order.fields.customerId;
      expect(field.type).toBe("uuid");
      const relation = field.rawRelation;
      expect(relation).toBeDefined();
      expect(relation.type).toBe("n-1");
      expect(relation.toward.type).toBe("Customer");
    });

    test("status is enum with correct values", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/order.ts"));
      expectEnumValues(mod.order.fields.status, [
        "pending",
        "processing",
        "shipped",
        "delivered",
        "cancelled",
      ]);
    });

    test("totalAmount is float optional", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/order.ts"));
      expectFieldType(mod.order.fields.totalAmount, "float", { required: false });
    });

    test("has timestamps", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/order.ts"));
      expectTimestamps(mod.order);
    });
  });

  // ---------------------------------------------------------------------------
  // OrderItem model
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
        "productId",
        "quantity",
        "unitPrice",
        "lineTotal",
        "createdAt",
        "updatedAt",
      ]);
    });

    test("orderId has n-1 relation to Order", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/orderItem.ts"));
      const field = mod.orderItem.fields.orderId;
      expect(field.type).toBe("uuid");
      const relation = field.rawRelation;
      expect(relation).toBeDefined();
      expect(relation.type).toBe("n-1");
      expect(relation.toward.type).toBe("Order");
    });

    test("productId has n-1 relation to Product", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/orderItem.ts"));
      const field = mod.orderItem.fields.productId;
      expect(field.type).toBe("uuid");
      const relation = field.rawRelation;
      expect(relation).toBeDefined();
      expect(relation.type).toBe("n-1");
      expect(relation.toward.type).toBe("Product");
    });

    test("quantity is int required and validated > 0", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/orderItem.ts"));
      expectFieldType(mod.orderItem.fields.quantity, "integer", { required: true });
      const validators = mod.orderItem.fields.quantity.metadata.validate;
      expect(validators).toBeDefined();
      const [validator] = validators;
      const fn = typeof validator === "function" ? validator : validator[0];
      expect(fn({ value: 0, data: {}, user: {} })).toBe(false);
      expect(fn({ value: 1, data: {}, user: {} })).toBe(true);
      expect(fn({ value: -1, data: {}, user: {} })).toBe(false);
    });

    test("unitPrice is float required and validated >= 0", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/orderItem.ts"));
      expectFieldType(mod.orderItem.fields.unitPrice, "float", { required: true });
      const validators = mod.orderItem.fields.unitPrice.metadata.validate;
      expect(validators).toBeDefined();
      const [validator] = validators;
      const fn = typeof validator === "function" ? validator : validator[0];
      expect(fn({ value: -1, data: {}, user: {} })).toBe(false);
      expect(fn({ value: 0, data: {}, user: {} })).toBe(true);
      expect(fn({ value: 10.5, data: {}, user: {} })).toBe(true);
    });

    test("lineTotal is float required", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/orderItem.ts"));
      expectFieldType(mod.orderItem.fields.lineTotal, "float", { required: true });
    });

    test("lineTotal create hook calculates quantity * unitPrice", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/orderItem.ts"));
      const hooks = mod.orderItem.fields.lineTotal.metadata.hooks;
      expect(hooks).toBeDefined();
      expect(hooks.create).toBeDefined();
      const result = hooks.create({
        data: { quantity: 3, unitPrice: 10.5 },
        value: null,
        user: {},
      });
      expect(result).toBeCloseTo(31.5);
    });

    test("lineTotal create hook returns 0 when quantity is 0", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/orderItem.ts"));
      const hooks = mod.orderItem.fields.lineTotal.metadata.hooks;
      const result = hooks.create({
        data: { quantity: 0, unitPrice: 10 },
        value: null,
        user: {},
      });
      expect(result).toBe(0);
    });

    test("lineTotal create hook handles missing quantity", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/orderItem.ts"));
      const hooks = mod.orderItem.fields.lineTotal.metadata.hooks;
      const result = hooks.create({
        data: { unitPrice: 10 },
        value: null,
        user: {},
      });
      expect(result).toBe(0);
    });

    test("has timestamps", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/orderItem.ts"));
      expectTimestamps(mod.orderItem);
    });
  });
});
