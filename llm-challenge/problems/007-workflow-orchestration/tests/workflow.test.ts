import { describe, expect, test } from "vitest";
import path from "node:path";
import {
  createWorkDirContext,
  expectFilesExist,
  importPath,
} from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("007-workflow-orchestration", () => {
  const checkInventoryPath = path.join(workDir, "workflows/fulfillment/checkInventory.ts");
  const processPaymentPath = path.join(workDir, "workflows/fulfillment/processPayment.ts");
  const shipOrderPath = path.join(workDir, "workflows/fulfillment/shipOrder.ts");
  const fulfillOrderPath = path.join(workDir, "workflows/fulfillment/fulfillOrder.ts");

  test("all 4 workflow files exist", () => {
    expectFilesExist([checkInventoryPath, processPaymentPath, shipOrderPath, fulfillOrderPath]);
  });

  // --- fulfillOrder exports ---

  test("fulfillOrder.ts has default export (the workflow)", async () => {
    const mod = await importPath(fulfillOrderPath);
    expect(mod.default).toBeDefined();
  });

  test("fulfillOrder.ts has named exports for all 4 jobs", async () => {
    const mod = await importPath(fulfillOrderPath);
    expect(mod.fulfillOrder).toBeDefined();
    expect(mod.checkInventory).toBeDefined();
    expect(mod.processPayment).toBeDefined();
    expect(mod.shipOrder).toBeDefined();
  });

  // --- Workflow metadata ---

  test("workflow name is 'order-fulfillment'", async () => {
    const mod = await importPath(fulfillOrderPath);
    expect(mod.default.name).toBe("order-fulfillment");
  });

  test("workflow mainJob references fulfillOrder", async () => {
    const mod = await importPath(fulfillOrderPath);
    expect(mod.default.mainJob).toBe(mod.fulfillOrder);
  });

  // --- Job names ---

  test("checkInventory job has correct name", async () => {
    const mod = await importPath(fulfillOrderPath);
    expect(mod.checkInventory.name).toBe("check-inventory");
  });

  test("processPayment job has correct name", async () => {
    const mod = await importPath(fulfillOrderPath);
    expect(mod.processPayment.name).toBe("process-payment");
  });

  test("shipOrder job has correct name", async () => {
    const mod = await importPath(fulfillOrderPath);
    expect(mod.shipOrder.name).toBe("ship-order");
  });

  test("fulfillOrder job has correct name", async () => {
    const mod = await importPath(fulfillOrderPath);
    expect(mod.fulfillOrder.name).toBe("fulfill-order");
  });

  test("all job names are unique", async () => {
    const mod = await importPath(fulfillOrderPath);
    const names = [
      mod.checkInventory.name,
      mod.processPayment.name,
      mod.shipOrder.name,
      mod.fulfillOrder.name,
    ];
    expect(new Set(names).size).toBe(4);
  });

  // --- checkInventory body ---

  test("checkInventory body returns correct structure", async () => {
    const mod = await importPath(checkInventoryPath);
    const result = await mod.checkInventory.body({ orderId: "o1" }, { env: {} });
    expect(result).toEqual({ available: true, orderId: "o1" });
  });

  test("checkInventory body uses input orderId", async () => {
    const mod = await importPath(checkInventoryPath);
    const result = await mod.checkInventory.body({ orderId: "xyz-999" }, { env: {} });
    expect(result.orderId).toBe("xyz-999");
  });

  // --- processPayment body ---

  test("processPayment body returns correct structure", async () => {
    const mod = await importPath(processPaymentPath);
    const result = await mod.processPayment.body({ orderId: "o1", amount: 99 }, { env: {} });
    expect(result).toEqual({ paid: true, transactionId: "txn-o1" });
  });

  test("processPayment body builds transactionId from orderId", async () => {
    const mod = await importPath(processPaymentPath);
    const result = await mod.processPayment.body({ orderId: "abc-123", amount: 50 }, { env: {} });
    expect(result.transactionId).toBe("txn-abc-123");
  });

  // --- shipOrder body ---

  test("shipOrder body returns correct structure", async () => {
    const mod = await importPath(shipOrderPath);
    const result = await mod.shipOrder.body({ orderId: "o1" }, { env: {} });
    expect(result).toEqual({ shipped: true, orderId: "o1", trackingId: "TRK-001" });
  });

  test("shipOrder body uses input orderId", async () => {
    const mod = await importPath(shipOrderPath);
    const result = await mod.shipOrder.body({ orderId: "ship-42" }, { env: {} });
    expect(result.orderId).toBe("ship-42");
    expect(result.shipped).toBe(true);
  });

  // --- fulfillOrder body (orchestration) ---

  test("fulfillOrder body returns object with inventory, payment, shipping keys", async () => {
    const mod = await importPath(fulfillOrderPath);
    const result = await mod.fulfillOrder.body({ orderId: "o1", amount: 100 }, { env: {} });
    expect(result).toHaveProperty("inventory");
    expect(result).toHaveProperty("payment");
    expect(result).toHaveProperty("shipping");
  });

  test("fulfillOrder body triggers produce correct results when resolved", async () => {
    const mod = await importPath(fulfillOrderPath);
    const result = await mod.fulfillOrder.body({ orderId: "o-final", amount: 200 }, { env: {} });
    const inventory = await result.inventory;
    const payment = await result.payment;
    const shipping = await result.shipping;
    expect(inventory).toEqual({ available: true, orderId: "o-final" });
    expect(payment).toEqual({ paid: true, transactionId: "txn-o-final" });
    expect(shipping).toEqual({ shipped: true, orderId: "o-final", trackingId: "TRK-001" });
  });

  // --- Individual job bodies are functions ---

  test("checkInventory has a body function", async () => {
    const mod = await importPath(checkInventoryPath);
    expect(typeof mod.checkInventory.body).toBe("function");
  });

  test("processPayment has a body function", async () => {
    const mod = await importPath(processPaymentPath);
    expect(typeof mod.processPayment.body).toBe("function");
  });

  test("shipOrder has a body function", async () => {
    const mod = await importPath(shipOrderPath);
    expect(typeof mod.shipOrder.body).toBe("function");
  });

  test("fulfillOrder has a body function", async () => {
    const mod = await importPath(fulfillOrderPath);
    expect(typeof mod.fulfillOrder.body).toBe("function");
  });
});
