import { beforeAll, describe, expect, test } from "vitest";
import path from "node:path";
import {
  createWorkDirContext,
  expectFunctionOperation,
  expectNonEmptyDescription,
  importPath,
} from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("003-event-driven-automation", () => {
  // ---------------------------------------------------------------------------
  // orderCreatedNotify
  // ---------------------------------------------------------------------------
  describe("orderCreatedNotify", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic module shape from importPath
    let executor: Record<string, any>;

    beforeAll(async () => {
      const mod = await importPath(path.join(workDir, "executors/orderCreatedNotify.ts"));
      executor = mod.default;
    });

    test("name is order-created-notify", () => {
      expect(executor.name).toBe("order-created-notify");
    });

    test("has non-empty description", () => {
      expectNonEmptyDescription(executor);
    });

    test("trigger is recordCreated on Order", () => {
      expect(executor.trigger.kind).toBe("recordCreated");
      expect(executor.trigger.typeName).toBe("Order");
    });

    test("condition filters high-value orders (> 100, not >=)", () => {
      const { condition } = executor.trigger;
      expect(condition({ newRecord: { totalAmount: 150 } })).toBe(true);
      expect(condition({ newRecord: { totalAmount: 100 } })).toBe(false);
      expect(condition({ newRecord: { totalAmount: 50 } })).toBe(false);
    });

    test("operation kind is webhook", () => {
      expect(executor.operation.kind).toBe("webhook");
    });

    test("webhook has vault secret header", () => {
      const { headers } = executor.operation;
      expect(headers.Authorization).toEqual({
        vault: "notification-service",
        key: "api-key",
      });
    });
  });

  // ---------------------------------------------------------------------------
  // orderStatusSync
  // ---------------------------------------------------------------------------
  describe("orderStatusSync", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic module shape from importPath
    let executor: Record<string, any>;

    beforeAll(async () => {
      const mod = await importPath(path.join(workDir, "executors/orderStatusSync.ts"));
      executor = mod.default;
    });

    test("name is order-status-sync", () => {
      expect(executor.name).toBe("order-status-sync");
    });

    test("has non-empty description", () => {
      expectNonEmptyDescription(executor);
    });

    test("trigger is recordUpdated on Order", () => {
      expect(executor.trigger.kind).toBe("recordUpdated");
      expect(executor.trigger.typeName).toBe("Order");
    });

    test("condition fires on transition from processing to shipped", () => {
      const { condition } = executor.trigger;
      expect(
        condition({
          newRecord: { status: "shipped" },
          oldRecord: { status: "processing" },
        }),
      ).toBe(true);
    });

    test("condition fires on transition from pending to shipped", () => {
      const { condition } = executor.trigger;
      expect(
        condition({
          newRecord: { status: "shipped" },
          oldRecord: { status: "pending" },
        }),
      ).toBe(true);
    });

    test("condition does not fire when already shipped", () => {
      const { condition } = executor.trigger;
      expect(
        condition({
          newRecord: { status: "shipped" },
          oldRecord: { status: "shipped" },
        }),
      ).toBe(false);
    });

    test("condition does not fire on transition from shipped to delivered", () => {
      const { condition } = executor.trigger;
      expect(
        condition({
          newRecord: { status: "delivered" },
          oldRecord: { status: "shipped" },
        }),
      ).toBe(false);
    });

    test("operation kind is graphql", () => {
      expect(executor.operation.kind).toBe("graphql");
    });

    test("graphql has query and variables function", () => {
      expect(typeof executor.operation.query).toBe("string");
      expect(typeof executor.operation.variables).toBe("function");
    });
  });

  // ---------------------------------------------------------------------------
  // auditLog
  // ---------------------------------------------------------------------------
  describe("auditLog", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic module shape from importPath
    let executor: Record<string, any>;

    beforeAll(async () => {
      const mod = await importPath(path.join(workDir, "executors/auditLog.ts"));
      executor = mod.default;
    });

    test("name is audit-log", () => {
      expect(executor.name).toBe("audit-log");
    });

    test("has non-empty description", () => {
      expectNonEmptyDescription(executor);
    });

    test("trigger is resolverExecuted on processAudit", () => {
      expect(executor.trigger.kind).toBe("resolverExecuted");
      expect(executor.trigger.resolverName).toBe("processAudit");
    });

    test("operation is function with callable body", () => {
      expectFunctionOperation(executor);
    });

    test("body handles success case without throwing", async () => {
      await expect(
        executor.operation.body({ success: true, result: { action: "test" } }),
      ).resolves.not.toThrow();
    });

    test("body handles failure case without throwing", async () => {
      await expect(
        executor.operation.body({ success: false, error: "something went wrong" }),
      ).resolves.not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // dailyReconciliation
  // ---------------------------------------------------------------------------
  describe("dailyReconciliation", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic module shape from importPath
    let executor: Record<string, any>;

    beforeAll(async () => {
      const mod = await importPath(path.join(workDir, "executors/dailyReconciliation.ts"));
      executor = mod.default;
    });

    test("name is daily-reconciliation", () => {
      expect(executor.name).toBe("daily-reconciliation");
    });

    test("has non-empty description", () => {
      expectNonEmptyDescription(executor);
    });

    test("trigger is schedule", () => {
      expect(executor.trigger.kind).toBe("schedule");
    });

    test("trigger cron is 0 2 * * *", () => {
      expect(executor.trigger.cron).toBe("0 2 * * *");
    });

    test("operation kind is workflow", () => {
      expect(executor.operation.kind).toBe("workflow");
    });

    test("operation has authInvoker with correct machineUserName", () => {
      expect(executor.operation.authInvoker).toBeDefined();
      expect(executor.operation.authInvoker.machineUserName).toBe("reconciliation-user");
    });
  });

  // ---------------------------------------------------------------------------
  // paymentReceived
  // ---------------------------------------------------------------------------
  describe("paymentReceived", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic module shape from importPath
    let executor: Record<string, any>;

    beforeAll(async () => {
      const mod = await importPath(path.join(workDir, "executors/paymentReceived.ts"));
      executor = mod.default;
    });

    test("name is payment-received", () => {
      expect(executor.name).toBe("payment-received");
    });

    test("has non-empty description", () => {
      expectNonEmptyDescription(executor);
    });

    test("trigger is incomingWebhook", () => {
      expect(executor.trigger.kind).toBe("incomingWebhook");
    });

    test("operation is function with callable body", () => {
      expectFunctionOperation(executor);
    });

    test("body processes valid webhook with signature without throwing", async () => {
      await expect(
        executor.operation.body({
          body: { paymentId: "pay-1", amount: 99.99, orderId: "ord-1" },
          headers: { "x-webhook-signature": "valid-sig" },
          method: "POST",
          rawBody: "{}",
          env: {},
        }),
      ).resolves.not.toThrow();
    });

    test("body handles missing signature without throwing", async () => {
      await expect(
        executor.operation.body({
          body: { paymentId: "pay-1", amount: 99.99, orderId: "ord-1" },
          headers: {},
          method: "POST",
          rawBody: "{}",
          env: {},
        }),
      ).resolves.not.toThrow();
    });
  });
});
