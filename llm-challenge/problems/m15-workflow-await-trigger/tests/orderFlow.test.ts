import path from "node:path";
import { describe, expect, test } from "vitest";
import { createWorkDirContext, importPath } from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("m15-workflow-await-trigger", () => {
  test("default export is the 'order-flow' workflow with processOrder as mainJob", async () => {
    const mod = await importPath(path.join(workDir, "workflows/orderFlow.ts"));
    expect(mod.default).toBeDefined();
    expect(mod.default.name).toBe("order-flow");
    expect(mod.default.mainJob).toBeDefined();
    expect(mod.default.mainJob.name).toBe("process-order");
  });

  test("calculateTotal is a named export and computes the multiplication", async () => {
    const mod = await importPath(path.join(workDir, "workflows/orderFlow.ts"));
    expect(mod.calculateTotal).toBeDefined();
    expect(mod.calculateTotal.name).toBe("calculate-total");
    const result = await mod.calculateTotal.body({ quantity: 3, unitPrice: 7 });
    expect(result).toEqual({ total: 21 });
  });

  test("processOrder awaits calculateTotal.trigger() and exposes total in its output", async () => {
    const mod = await importPath(path.join(workDir, "workflows/orderFlow.ts"));
    // The runtime trigger() implementation in the SDK calls the body directly
    // (see createWorkflowJob in @tailor-platform/sdk). If processOrder forgets
    // to await the Promise returned by trigger(), `total` will be undefined
    // here and destructuring `{ total }` will fail to surface a number.
    const result = await mod.processOrder.body({
      orderId: "order-42",
      quantity: 4,
      unitPrice: 25,
    });
    expect(result).toEqual({ orderId: "order-42", total: 100 });
  });
});
