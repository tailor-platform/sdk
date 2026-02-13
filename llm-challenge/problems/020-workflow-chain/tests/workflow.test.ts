import { describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";

const workDir = path.resolve(import.meta.dirname, "..", "work");
const workDirExists = fs.existsSync(workDir);

describe.skipIf(!workDirExists)("020-workflow-chain", () => {
  const workflowPath = path.join(workDir, "workflows/order-fulfillment.ts");

  test("workflows/order-fulfillment.ts exists", () => {
    expect(fs.existsSync(workflowPath)).toBe(true);
  });

  test("has default export (workflow)", async () => {
    const mod = await import(workflowPath);
    expect(mod.default).toBeDefined();
  });

  test("has named exports for all 3 jobs", async () => {
    const mod = await import(workflowPath);
    expect(mod.checkInventory).toBeDefined();
    expect(mod.processPayment).toBeDefined();
    expect(mod.fulfillOrder).toBeDefined();
  });

  test("workflow name is 'order-fulfillment'", async () => {
    const mod = await import(workflowPath);
    expect(mod.default.name).toBe("order-fulfillment");
  });

  test("workflow mainJob references fulfillOrder", async () => {
    const mod = await import(workflowPath);
    expect(mod.default.mainJob).toBe(mod.fulfillOrder);
  });

  test("checkInventory job has correct name", async () => {
    const mod = await import(workflowPath);
    expect(mod.checkInventory.name).toBe("check-inventory");
  });

  test("processPayment job has correct name", async () => {
    const mod = await import(workflowPath);
    expect(mod.processPayment.name).toBe("process-payment");
  });

  test("fulfillOrder job has correct name", async () => {
    const mod = await import(workflowPath);
    expect(mod.fulfillOrder.name).toBe("fulfill-order");
  });

  test("checkInventory body returns correct structure", async () => {
    const mod = await import(workflowPath);
    const result = await mod.checkInventory.body({ orderId: "order-123" }, { env: {} });
    expect(result).toEqual({
      available: true,
      orderId: "order-123",
    });
  });

  test("processPayment body returns correct structure", async () => {
    const mod = await import(workflowPath);
    const result = await mod.processPayment.body(
      { orderId: "order-456", amount: 99.99 },
      { env: {} },
    );
    expect(result).toEqual({
      paid: true,
      transactionId: "txn-order-456",
    });
  });

  test("fulfillOrder body calls trigger and returns correct structure", async () => {
    const mod = await import(workflowPath);
    const result = mod.fulfillOrder.body({ orderId: "order-789", amount: 50.0 }, { env: {} });
    expect(result).toHaveProperty("orderId", "order-789");
    expect(result).toHaveProperty("inventory");
    expect(result).toHaveProperty("payment");
    // .trigger() is async in SDK default impl, so resolve Promises
    const inventory = await result.inventory;
    const payment = await result.payment;
    expect(inventory).toEqual({ available: true, orderId: "order-789" });
    expect(payment).toEqual({ paid: true, transactionId: "txn-order-789" });
  });
});
