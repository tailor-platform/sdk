import { afterAll, beforeAll, describe, expect, test } from "vitest";
import path from "node:path";
import {
  createWorkDirContext,
  expectFieldNames,
  expectTimestamps,
  expectEnumValues,
  importPath,
} from "../../../shared/test-helpers.js";
import { setupWorkflowMock, cleanupMocks } from "../../../shared/mocks.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("006-fix-broken-order-system", () => {
  // ---------------------------------------------------------------------------
  // Model fixes
  // ---------------------------------------------------------------------------
  describe("orderModel fixes", () => {
    test("model name is OrderModel (PascalCase)", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/orderModel.ts"));
      expect(mod.orderModel.name).toBe("OrderModel");
    });

    test("status enum has exactly 4 unique values", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/orderModel.ts"));
      expectEnumValues(mod.orderModel.fields.status, [
        "pending",
        "confirmed",
        "shipped",
        "delivered",
      ]);
    });

    test("quantity validation rejects 0", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/orderModel.ts"));
      const validators = mod.orderModel.fields.quantity.metadata.validate;
      expect(validators).toBeDefined();
      const [validator] = validators;
      const fn = typeof validator === "function" ? validator : validator[0];
      expect(fn({ value: 0, data: {}, user: {} })).toBe(false);
    });

    test("quantity validation accepts 1", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/orderModel.ts"));
      const validators = mod.orderModel.fields.quantity.metadata.validate;
      const [validator] = validators;
      const fn = typeof validator === "function" ? validator : validator[0];
      expect(fn({ value: 1, data: {}, user: {} })).toBe(true);
    });

    test("totalPrice hook uses multiplication (5 * 10 = 50)", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/orderModel.ts"));
      const hooks = mod.orderModel.fields.totalPrice.metadata.hooks;
      expect(hooks).toBeDefined();
      expect(hooks.create).toBeDefined();
      const result = hooks.create({
        data: { quantity: 5, unitPrice: 10 },
        value: null,
        user: {},
      });
      expect(result).toBe(50);
    });

    test("totalPrice hook calculates correctly (3 * 7.5 = 22.5)", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/orderModel.ts"));
      const hooks = mod.orderModel.fields.totalPrice.metadata.hooks;
      const result = hooks.create({
        data: { quantity: 3, unitPrice: 7.5 },
        value: null,
        user: {},
      });
      expect(result).toBeCloseTo(22.5);
    });

    test("has timestamps (createdAt and updatedAt)", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/orderModel.ts"));
      expectTimestamps(mod.orderModel);
    });

    test("has type export", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/orderModel.ts"));
      expect(mod.orderModel).toBeDefined();
      expectFieldNames(mod.orderModel, [
        "customerName",
        "customerEmail",
        "status",
        "quantity",
        "unitPrice",
        "totalPrice",
        "discount",
        "notes",
        "createdAt",
        "updatedAt",
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  // Resolver fixes
  // ---------------------------------------------------------------------------
  describe("calculateOrder fixes", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic module shape from importPath
    let resolver: Record<string, any>;

    beforeAll(async () => {
      const mod = await importPath(path.join(workDir, "resolvers/calculateOrder.ts"));
      resolver = mod.default;
    });

    test("resolver name is calculateOrder (camelCase)", () => {
      expect(resolver.name).toBe("calculateOrder");
    });

    test("input items use unitPrice (camelCase)", () => {
      const itemFields = resolver.input.items.fields;
      expect(itemFields).toHaveProperty("unitPrice");
      expect(itemFields).not.toHaveProperty("unit_price");
    });

    test("input has discountCode (camelCase)", () => {
      expect(resolver.input).toHaveProperty("discountCode");
      expect(resolver.input).not.toHaveProperty("discount_code");
    });

    test("input has memberTier (camelCase)", () => {
      expect(resolver.input).toHaveProperty("memberTier");
      expect(resolver.input).not.toHaveProperty("member_tier");
    });

    test("HALF discount: subtotal 100 -> afterDiscount 50", () => {
      const result = resolver.body({
        input: {
          items: [{ name: "A", unitPrice: 100, quantity: 1 }],
          discountCode: "HALF",
          memberTier: "bronze",
        },
        user: { id: "u1", type: "user", attributes: {} },
        env: {},
      });
      expect(result.subtotal).toBe(100);
      expect(result.afterDiscount).toBe(50);
    });

    test("QUARTER discount: subtotal 200 -> afterDiscount 150", () => {
      const result = resolver.body({
        input: {
          items: [{ name: "A", unitPrice: 100, quantity: 2 }],
          discountCode: "QUARTER",
          memberTier: "bronze",
        },
        user: { id: "u1", type: "user", attributes: {} },
        env: {},
      });
      expect(result.subtotal).toBe(200);
      expect(result.afterDiscount).toBe(150);
    });

    test("gold tier applies 10% on afterDiscount (100 -> 90)", () => {
      const result = resolver.body({
        input: {
          items: [{ name: "A", unitPrice: 100, quantity: 1 }],
          memberTier: "gold",
        },
        user: { id: "u1", type: "user", attributes: {} },
        env: {},
      });
      expect(result.afterDiscount).toBe(100);
      expect(result.finalTotal).toBe(90);
    });

    test("itemCount sums quantities (2 + 3 = 5)", () => {
      const result = resolver.body({
        input: {
          items: [
            { name: "A", unitPrice: 10, quantity: 2 },
            { name: "B", unitPrice: 20, quantity: 3 },
          ],
          memberTier: "bronze",
        },
        user: { id: "u1", type: "user", attributes: {} },
        env: {},
      });
      expect(result.itemCount).toBe(5);
    });

    test("output uses camelCase field names", () => {
      const fields = resolver.output.fields;
      expect(fields).toHaveProperty("afterDiscount");
      expect(fields).toHaveProperty("finalTotal");
      expect(fields).toHaveProperty("itemCount");
      expect(fields).not.toHaveProperty("after_discount");
      expect(fields).not.toHaveProperty("final_total");
      expect(fields).not.toHaveProperty("item_count");
    });
  });

  // ---------------------------------------------------------------------------
  // Workflow fixes
  // ---------------------------------------------------------------------------
  describe("orderWorkflow fixes", () => {
    test("validateOrder is a named export", async () => {
      const mod = await importPath(path.join(workDir, "workflows/orderWorkflow.ts"));
      expect(mod.validateOrder).toBeDefined();
      expect(mod.validateOrder.name).toBe("validate-order");
    });

    test("processPayment is a named export with name process-payment", async () => {
      const mod = await importPath(path.join(workDir, "workflows/orderWorkflow.ts"));
      expect(mod.processPayment).toBeDefined();
      expect(mod.processPayment.name).toBe("process-payment");
    });

    test("shipOrder is a named export with name ship-order", async () => {
      const mod = await importPath(path.join(workDir, "workflows/orderWorkflow.ts"));
      expect(mod.shipOrder).toBeDefined();
      expect(mod.shipOrder.name).toBe("ship-order");
    });

    test("fulfillOrder is a named export", async () => {
      const mod = await importPath(path.join(workDir, "workflows/orderWorkflow.ts"));
      expect(mod.fulfillOrder).toBeDefined();
      expect(mod.fulfillOrder.name).toBe("fulfill-order");
    });

    test("workflow name is order-fulfillment (hyphen)", async () => {
      const mod = await importPath(path.join(workDir, "workflows/orderWorkflow.ts"));
      expect(mod.default.name).toBe("order-fulfillment");
    });

    test("default export exists (the workflow)", async () => {
      const mod = await importPath(path.join(workDir, "workflows/orderWorkflow.ts"));
      expect(mod.default).toBeDefined();
      expect(mod.default.name).toBeDefined();
      expect(mod.default.mainJob).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Workflow orchestration with mocks
  // ---------------------------------------------------------------------------
  describe("fulfillOrder orchestration", () => {
    let triggeredJobs: { jobName: string; args: unknown }[];

    beforeAll(() => {
      const mock = setupWorkflowMock((jobName, args) => {
        if (jobName === "validate-order") {
          const input = args as { orderId: string; amount: number };
          return { valid: input.amount > 0, orderId: input.orderId };
        }
        if (jobName === "process-payment") {
          const input = args as { orderId: string; amount: number };
          return { transactionId: `txn-${input.orderId}`, amount: input.amount };
        }
        if (jobName === "ship-order") {
          const input = args as { orderId: string };
          return { shipped: true, trackingId: `TRK-${input.orderId}` };
        }
        return {};
      });
      triggeredJobs = mock.triggeredJobs;
    });

    afterAll(() => {
      cleanupMocks();
    });

    test("valid input returns success with trackingId", async () => {
      triggeredJobs.length = 0;
      const mod = await importPath(path.join(workDir, "workflows/orderWorkflow.ts"));
      const result = await mod.fulfillOrder.body({
        orderId: "order-1",
        amount: 100,
      });
      expect(result.success).toBe(true);
      expect(result.transactionId).toBe("txn-order-1");
      expect(result.trackingId).toBe("TRK-order-1");
    });

    test("invalid input (amount=0) returns success false", async () => {
      triggeredJobs.length = 0;
      const mod = await importPath(path.join(workDir, "workflows/orderWorkflow.ts"));
      const result = await mod.fulfillOrder.body({
        orderId: "order-2",
        amount: 0,
      });
      expect(result.success).toBe(false);
    });
  });
});
