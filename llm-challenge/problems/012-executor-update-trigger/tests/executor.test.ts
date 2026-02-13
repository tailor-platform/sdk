import { describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";

const workDir = path.resolve(import.meta.dirname, "..", "work");
const workDirExists = fs.existsSync(workDir);

describe.skipIf(!workDirExists)("012-executor-update-trigger", () => {
  const executorPath = path.join(workDir, "executors/orderStatusChanged.ts");

  test("executors/orderStatusChanged.ts exists", () => {
    expect(fs.existsSync(executorPath)).toBe(true);
  });

  test("executor is a default export", async () => {
    const mod = await import(executorPath);
    expect(mod.default).toBeDefined();
  });

  test("executor has correct name", async () => {
    const { default: executor } = await import(executorPath);
    expect(executor.name).toBe("order-status-changed");
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

  test("trigger is a recordUpdated trigger", async () => {
    const { default: executor } = await import(executorPath);
    expect(executor.trigger.kind).toBe("recordUpdated");
  });

  test("trigger references the Order type", async () => {
    const { default: executor } = await import(executorPath);
    expect(executor.trigger.typeName).toBe("Order");
  });

  test("trigger has a condition function", async () => {
    const { default: executor } = await import(executorPath);
    expect(typeof executor.trigger.condition).toBe("function");
  });

  test("condition returns true when status changes", async () => {
    const { default: executor } = await import(executorPath);
    const result = executor.trigger.condition({
      newRecord: { status: "shipped" },
      oldRecord: { status: "pending" },
    });
    expect(result).toBe(true);
  });

  test("condition returns false when status stays same", async () => {
    const { default: executor } = await import(executorPath);
    const result = executor.trigger.condition({
      newRecord: { status: "pending" },
      oldRecord: { status: "pending" },
    });
    expect(result).toBe(false);
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
