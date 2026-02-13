import { describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";

const workDir = path.resolve(import.meta.dirname, "..", "work");
const workDirExists = fs.existsSync(workDir);

describe.skipIf(!workDirExists)("017-webhook-executor", () => {
  const executorPath = path.join(workDir, "executors/paymentWebhook.ts");

  test("executors/paymentWebhook.ts exists", () => {
    expect(fs.existsSync(executorPath)).toBe(true);
  });

  test("executor is a default export", async () => {
    const mod = await import(executorPath);
    expect(mod.default).toBeDefined();
  });

  test("executor has correct name", async () => {
    const { default: executor } = await import(executorPath);
    expect(executor.name).toBe("payment-webhook");
  });

  test("executor has a description", async () => {
    const { default: executor } = await import(executorPath);
    expect(executor.description).toBeDefined();
    expect(typeof executor.description).toBe("string");
  });

  test("executor has a trigger configuration", async () => {
    const { default: executor } = await import(executorPath);
    expect(executor.trigger).toBeDefined();
  });

  test("trigger kind is incomingWebhook", async () => {
    const { default: executor } = await import(executorPath);
    expect(executor.trigger.kind).toBe("incomingWebhook");
  });

  test("operation kind is function", async () => {
    const { default: executor } = await import(executorPath);
    expect(executor.operation).toBeDefined();
    expect(executor.operation.kind).toBe("function");
  });

  test("operation body is a callable function", async () => {
    const { default: executor } = await import(executorPath);
    expect(typeof executor.operation.body).toBe("function");
  });
});
