import { describe, expect, test } from "vitest";
import path from "node:path";
import {
  createWorkDirContext,
  expectFilesExist,
  expectFunctionOperation,
  expectNonEmptyDescription,
  importPath,
} from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("006-advanced-executor-operations", () => {
  const dailyReportPath = path.join(workDir, "executors/dailyReport.ts");
  const paymentWebhookPath = path.join(workDir, "executors/paymentWebhook.ts");
  const triggerWorkflowPath = path.join(workDir, "executors/triggerWorkflow.ts");
  const notifyExternalPath = path.join(workDir, "executors/notifyExternal.ts");
  const syncDataPath = path.join(workDir, "executors/syncData.ts");

  test("all 5 executor files exist", () => {
    expectFilesExist([
      dailyReportPath,
      paymentWebhookPath,
      triggerWorkflowPath,
      notifyExternalPath,
      syncDataPath,
    ]);
  });

  // --- dailyReport ---

  test("dailyReport is a default export", async () => {
    const mod = await importPath(dailyReportPath);
    expect(mod.default).toBeDefined();
  });

  test("dailyReport has correct name", async () => {
    const { default: executor } = await importPath(dailyReportPath);
    expect(executor.name).toBe("daily-report");
  });

  test("dailyReport has a non-empty description", async () => {
    const { default: executor } = await importPath(dailyReportPath);
    expectNonEmptyDescription(executor);
  });

  test("dailyReport trigger kind is schedule", async () => {
    const { default: executor } = await importPath(dailyReportPath);
    expect(executor.trigger.kind).toBe("schedule");
  });

  test("dailyReport trigger has correct cron expression", async () => {
    const { default: executor } = await importPath(dailyReportPath);
    expect(executor.trigger.cron).toBe("0 9 * * *");
  });

  test("dailyReport trigger has correct timezone", async () => {
    const { default: executor } = await importPath(dailyReportPath);
    expect(executor.trigger.timezone).toBe("Asia/Tokyo");
  });

  test("dailyReport operation is a function", async () => {
    const { default: executor } = await importPath(dailyReportPath);
    expectFunctionOperation(executor);
  });

  // --- paymentWebhook ---

  test("paymentWebhook is a default export", async () => {
    const mod = await importPath(paymentWebhookPath);
    expect(mod.default).toBeDefined();
  });

  test("paymentWebhook has correct name", async () => {
    const { default: executor } = await importPath(paymentWebhookPath);
    expect(executor.name).toBe("payment-webhook");
  });

  test("paymentWebhook trigger kind is incomingWebhook", async () => {
    const { default: executor } = await importPath(paymentWebhookPath);
    expect(executor.trigger.kind).toBe("incomingWebhook");
  });

  test("paymentWebhook operation body is a callable function", async () => {
    const { default: executor } = await importPath(paymentWebhookPath);
    expectFunctionOperation(executor);
  });

  // --- triggerWorkflow ---

  test("triggerWorkflow is a default export", async () => {
    const mod = await importPath(triggerWorkflowPath);
    expect(mod.default).toBeDefined();
  });

  test("triggerWorkflow has correct name", async () => {
    const { default: executor } = await importPath(triggerWorkflowPath);
    expect(executor.name).toBe("order-created-trigger-workflow");
  });

  test("triggerWorkflow has a non-empty description", async () => {
    const { default: executor } = await importPath(triggerWorkflowPath);
    expectNonEmptyDescription(executor);
  });

  test("triggerWorkflow trigger kind is recordCreated", async () => {
    const { default: executor } = await importPath(triggerWorkflowPath);
    expect(executor.trigger.kind).toBe("recordCreated");
  });

  test("triggerWorkflow operation kind is workflow", async () => {
    const { default: executor } = await importPath(triggerWorkflowPath);
    expect(executor.operation.kind).toBe("workflow");
  });

  test("triggerWorkflow operation has workflow reference", async () => {
    const { default: executor } = await importPath(triggerWorkflowPath);
    expect(executor.operation.workflow).toBeDefined();
  });

  test("triggerWorkflow operation has args function", async () => {
    const { default: executor } = await importPath(triggerWorkflowPath);
    expect(typeof executor.operation.args).toBe("function");
  });

  test("triggerWorkflow args function extracts orderId from newRecord", async () => {
    const { default: executor } = await importPath(triggerWorkflowPath);
    const result = executor.operation.args({
      newRecord: { id: "order-123", customerId: "cust-1", totalAmount: 100 },
    });
    expect(result).toEqual({ orderId: "order-123" });
  });

  // --- notifyExternal ---

  test("notifyExternal is a default export", async () => {
    const mod = await importPath(notifyExternalPath);
    expect(mod.default).toBeDefined();
  });

  test("notifyExternal has correct name", async () => {
    const { default: executor } = await importPath(notifyExternalPath);
    expect(executor.name).toBe("notify-external-service");
  });

  test("notifyExternal trigger kind is recordCreated", async () => {
    const { default: executor } = await importPath(notifyExternalPath);
    expect(executor.trigger.kind).toBe("recordCreated");
  });

  test("notifyExternal operation kind is webhook", async () => {
    const { default: executor } = await importPath(notifyExternalPath);
    expect(executor.operation.kind).toBe("webhook");
  });

  test("notifyExternal url is a function that builds correct URL", async () => {
    const { default: executor } = await importPath(notifyExternalPath);
    expect(typeof executor.operation.url).toBe("function");
    const url = executor.operation.url({
      newRecord: { id: "order-456" },
    });
    expect(url).toContain("order-456");
    expect(url).toMatch(/^https?:\/\//);
  });

  test("notifyExternal requestBody is a function that returns order data", async () => {
    const { default: executor } = await importPath(notifyExternalPath);
    expect(typeof executor.operation.requestBody).toBe("function");
    const body = executor.operation.requestBody({
      newRecord: { id: "o-1", customerId: "c-1", totalAmount: 250.5 },
    });
    expect(body).toHaveProperty("orderId", "o-1");
    expect(body).toHaveProperty("customerId", "c-1");
    expect(body).toHaveProperty("totalAmount", 250.5);
  });

  test("notifyExternal headers include Content-Type", async () => {
    const { default: executor } = await importPath(notifyExternalPath);
    expect(executor.operation.headers).toBeDefined();
    expect(executor.operation.headers["Content-Type"]).toBe("application/json");
  });

  test("notifyExternal headers Authorization is a vault secret object", async () => {
    const { default: executor } = await importPath(notifyExternalPath);
    const auth = executor.operation.headers.Authorization;
    expect(auth).toBeDefined();
    expect(typeof auth).toBe("object");
    expect(auth.vault).toBe("api-secrets");
    expect(auth.key).toBe("external-api-token");
  });

  // --- syncData ---

  test("syncData is a default export", async () => {
    const mod = await importPath(syncDataPath);
    expect(mod.default).toBeDefined();
  });

  test("syncData has correct name", async () => {
    const { default: executor } = await importPath(syncDataPath);
    expect(executor.name).toBe("sync-product-data");
  });

  test("syncData has a non-empty description", async () => {
    const { default: executor } = await importPath(syncDataPath);
    expectNonEmptyDescription(executor);
  });

  test("syncData trigger kind is resolverExecuted", async () => {
    const { default: executor } = await importPath(syncDataPath);
    expect(executor.trigger.kind).toBe("resolverExecuted");
  });

  test("syncData trigger has condition function", async () => {
    const { default: executor } = await importPath(syncDataPath);
    expect(typeof executor.trigger.condition).toBe("function");
  });

  test("syncData trigger condition returns true on success", async () => {
    const { default: executor } = await importPath(syncDataPath);
    expect(executor.trigger.condition({ success: true })).toBe(true);
  });

  test("syncData trigger condition returns false on failure", async () => {
    const { default: executor } = await importPath(syncDataPath);
    expect(executor.trigger.condition({ success: false })).toBe(false);
  });

  test("syncData operation kind is graphql", async () => {
    const { default: executor } = await importPath(syncDataPath);
    expect(executor.operation.kind).toBe("graphql");
  });

  test("syncData operation has appName", async () => {
    const { default: executor } = await importPath(syncDataPath);
    expect(typeof executor.operation.appName).toBe("string");
  });

  test("syncData operation query contains syncProduct", async () => {
    const { default: executor } = await importPath(syncDataPath);
    expect(typeof executor.operation.query).toBe("string");
    expect(executor.operation.query).toMatch(/syncProduct/i);
  });

  test("syncData operation has variables function", async () => {
    const { default: executor } = await importPath(syncDataPath);
    expect(typeof executor.operation.variables).toBe("function");
  });

  test("syncData operation variables function returns data on success", async () => {
    const { default: executor } = await importPath(syncDataPath);
    const vars = executor.operation.variables({
      success: true,
      result: { id: "prod-1", updated: true },
    });
    expect(vars).toBeDefined();
    expect(typeof vars).toBe("object");
    expect(vars).toHaveProperty("id");
  });

  test("syncData operation has authInvoker with namespace and machineUserName", async () => {
    const { default: executor } = await importPath(syncDataPath);
    expect(executor.operation.authInvoker).toBeDefined();
    expect(typeof executor.operation.authInvoker.namespace).toBe("string");
    expect(typeof executor.operation.authInvoker.machineUserName).toBe("string");
  });
});
