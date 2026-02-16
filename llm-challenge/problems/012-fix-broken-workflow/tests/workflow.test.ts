import { describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";

const workDir = path.resolve(import.meta.dirname, "..", "work");
const workDirReady = fs.existsSync(path.join(workDir, "node_modules"));

describe.skipIf(!workDirReady)("012-fix-broken-workflow", () => {
  const workflowPath = path.join(workDir, "workflows/orderPipeline.ts");

  test("workflows/orderPipeline.ts exists", () => {
    expect(fs.existsSync(workflowPath)).toBe(true);
  });

  test("has default export (workflow)", async () => {
    const mod = await import(workflowPath);
    expect(mod.default).toBeDefined();
  });

  test("has named exports for all 3 jobs", async () => {
    const mod = await import(workflowPath);
    expect(mod.validatePayment).toBeDefined();
    expect(mod.shipOrder).toBeDefined();
    expect(mod.processOrder).toBeDefined();
  });

  test("workflow name is 'order-pipeline' (hyphens, not underscores)", async () => {
    const mod = await import(workflowPath);
    expect(mod.default.name).toBe("order-pipeline");
  });

  test("workflow mainJob is processOrder", async () => {
    const mod = await import(workflowPath);
    expect(mod.default.mainJob).toBe(mod.processOrder);
  });

  test("validatePayment job name is 'validate-payment'", async () => {
    const mod = await import(workflowPath);
    expect(mod.validatePayment.name).toBe("validate-payment");
  });

  test("shipOrder job name is 'ship-order'", async () => {
    const mod = await import(workflowPath);
    expect(mod.shipOrder.name).toBe("ship-order");
  });

  test("processOrder job name is 'process-order' (not duplicate 'validate-payment')", async () => {
    const mod = await import(workflowPath);
    expect(mod.processOrder.name).toBe("process-order");
  });

  test("all job names are unique", async () => {
    const mod = await import(workflowPath);
    const names = [mod.validatePayment.name, mod.shipOrder.name, mod.processOrder.name];
    expect(new Set(names).size).toBe(3);
  });

  test("validatePayment body returns correct structure", async () => {
    const mod = await import(workflowPath);
    const result = await mod.validatePayment.body({ orderId: "ord-1", amount: 50 }, { env: {} });
    expect(result).toEqual({ valid: true, orderId: "ord-1" });
  });

  test("validatePayment body handles zero amount", async () => {
    const mod = await import(workflowPath);
    const result = await mod.validatePayment.body({ orderId: "ord-2", amount: 0 }, { env: {} });
    expect(result).toEqual({ valid: false, orderId: "ord-2" });
  });

  test("shipOrder body returns orderId from input", async () => {
    const mod = await import(workflowPath);
    const result = await mod.shipOrder.body({ orderId: "ord-1" }, { env: {} });
    expect(result).toHaveProperty("shipped", true);
    expect(result).toHaveProperty("orderId", "ord-1");
    expect(result).toHaveProperty("trackingId");
  });

  test("processOrder body calls trigger and returns correct structure", async () => {
    const mod = await import(workflowPath);
    const result = mod.processOrder.body({ orderId: "ord-1", amount: 100 }, { env: {} });
    expect(result).toHaveProperty("payment");
    expect(result).toHaveProperty("shipping");
  });

  test("processOrder body trigger results resolve correctly", async () => {
    const mod = await import(workflowPath);
    const result = mod.processOrder.body({ orderId: "ord-1", amount: 100 }, { env: {} });
    const payment = await result.payment;
    const shipping = await result.shipping;
    expect(payment).toEqual({ valid: true, orderId: "ord-1" });
    expect(shipping).toEqual({
      shipped: true,
      orderId: "ord-1",
      trackingId: "TRK-001",
    });
  });
});
