import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  createWorkDirContext,
  expectFunctionOperation,
  expectNonEmptyDescription,
  importPath,
} from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("h06-executor-multi-trigger-record-and-resolver", () => {
  test("shared recordAudit helper returns the uniform `<source>:<reference>` entry", async () => {
    const mod = await importPath(path.join(workDir, "executors/_audit.ts"));
    expect(typeof mod.recordAudit).toBe("function");
    expect(mod.recordAudit({ source: "order", reference: "ord-1" })).toEqual({
      entry: "order:ord-1",
    });
    expect(mod.recordAudit({ source: "resolver", reference: "cancelOrder" })).toEqual({
      entry: "resolver:cancelOrder",
    });
  });

  test("order-touched executor fires on Order created+updated", async () => {
    const mod = await importPath(path.join(workDir, "executors/orderTouched.ts"));
    expect(mod.default.name).toBe("order-touched");
    expectNonEmptyDescription(mod.default);
    expectFunctionOperation(mod.default);
    const { trigger } = mod.default;
    expect(trigger.kind).toBe("tailordb");
    expect(trigger.typeName).toBe("Order");
    expect(trigger.events).toEqual([
      "tailordb.type_record.created",
      "tailordb.type_record.updated",
    ]);
  });

  test("cancel-audit executor targets the cancelOrder resolver", async () => {
    const mod = await importPath(path.join(workDir, "executors/cancelAudit.ts"));
    expect(mod.default.name).toBe("cancel-audit");
    expectNonEmptyDescription(mod.default);
    expectFunctionOperation(mod.default);
    const { trigger } = mod.default;
    expect(trigger.kind).toBe("resolverExecuted");
    expect(trigger.resolverName).toBe("cancelOrder");
  });

  test("both executor files import the shared helper instead of inlining the format", () => {
    const orderSource = fs.readFileSync(path.join(workDir, "executors/orderTouched.ts"), "utf-8");
    const cancelSource = fs.readFileSync(path.join(workDir, "executors/cancelAudit.ts"), "utf-8");
    expect(orderSource).toMatch(/recordAudit/);
    expect(orderSource).toMatch(/from\s+["'][.\\/]+_audit["']/);
    expect(cancelSource).toMatch(/recordAudit/);
    expect(cancelSource).toMatch(/from\s+["'][.\\/]+_audit["']/);
    // No inline `source:` template literal — must go through the helper.
    expect(orderSource).not.toMatch(/`\$\{[^}]+\}:\$\{[^}]+\}`/);
    expect(cancelSource).not.toMatch(/`\$\{[^}]+\}:\$\{[^}]+\}`/);
  });
});
