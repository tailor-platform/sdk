import { describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";

const workDir = path.resolve(import.meta.dirname, "..", "work");
const workDirExists = fs.existsSync(workDir);

describe.skipIf(!workDirExists)("036-workflow-multi-file", () => {
  const processOrderPath = path.join(workDir, "workflows/order/processOrder.ts");
  const validateOrderPath = path.join(workDir, "workflows/order/validateOrder.ts");
  const fulfillOrderPath = path.join(workDir, "workflows/order/fulfillOrder.ts");

  test("all 3 workflow files exist", () => {
    expect(fs.existsSync(processOrderPath)).toBe(true);
    expect(fs.existsSync(validateOrderPath)).toBe(true);
    expect(fs.existsSync(fulfillOrderPath)).toBe(true);
  });

  test("processOrder.ts has default export (the workflow)", async () => {
    const mod = await import(processOrderPath);
    expect(mod.default).toBeDefined();
  });

  test("processOrder.ts has named exports: processOrder, validateOrder, fulfillOrder", async () => {
    const mod = await import(processOrderPath);
    expect(mod.processOrder).toBeDefined();
    expect(mod.validateOrder).toBeDefined();
    expect(mod.fulfillOrder).toBeDefined();
  });

  test("workflow name is 'order-processing'", async () => {
    const mod = await import(processOrderPath);
    expect(mod.default.name).toBe("order-processing");
  });

  test("workflow mainJob is processOrder", async () => {
    const mod = await import(processOrderPath);
    expect(mod.default.mainJob).toBe(mod.processOrder);
  });

  test("validateOrder job has correct name 'validate-order'", async () => {
    const mod = await import(processOrderPath);
    expect(mod.validateOrder.name).toBe("validate-order");
  });

  test("fulfillOrder job has correct name 'fulfill-order'", async () => {
    const mod = await import(processOrderPath);
    expect(mod.fulfillOrder.name).toBe("fulfill-order");
  });

  test("processOrder job has correct name 'process-order'", async () => {
    const mod = await import(processOrderPath);
    expect(mod.processOrder.name).toBe("process-order");
  });

  test("validateOrder body returns isValid boolean", async () => {
    const mod = await import(validateOrderPath);
    const result = await mod.validateOrder.body(
      { orderId: "order-1", items: ["item-a"] },
      { env: {} },
    );
    expect(result.isValid).toBe(true);
    expect(typeof result.isValid).toBe("boolean");

    const emptyResult = await mod.validateOrder.body(
      { orderId: "order-2", items: [] },
      { env: {} },
    );
    expect(emptyResult.isValid).toBe(false);
  });

  test("fulfillOrder body returns status string", async () => {
    const mod = await import(fulfillOrderPath);
    const result = await mod.fulfillOrder.body({ orderId: "order-1" }, { env: {} });
    expect(typeof result.status).toBe("string");
    expect(result.status).toBe("fulfilled");
    expect(result.orderId).toBe("order-1");
  });

  test("processOrder body calls trigger on other jobs", async () => {
    const mod = await import(processOrderPath);
    const result = mod.processOrder.body({ orderId: "order-99", items: ["x", "y"] }, { env: {} });
    expect(result).toHaveProperty("validation");
    expect(result).toHaveProperty("fulfillment");
    // .trigger() returns Promises in SDK default impl
    const validation = await result.validation;
    const fulfillment = await result.fulfillment;
    expect(validation).toEqual({ orderId: "order-99", isValid: true });
    expect(fulfillment).toEqual({ orderId: "order-99", status: "fulfilled" });
  });
});
