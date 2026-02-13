import { describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";

const workDir = path.resolve(import.meta.dirname, "..", "work");
const workDirExists = fs.existsSync(workDir);

describe.skipIf(!workDirExists)("037-executor-workflow-operation", () => {
  const executorPath = path.join(workDir, "executors/triggerWorkflow.ts");

  test("executors/triggerWorkflow.ts exists", () => {
    expect(fs.existsSync(executorPath)).toBe(true);
  });

  test("executor is a default export", async () => {
    const mod = await import(executorPath);
    expect(mod.default).toBeDefined();
  });

  test("executor name is 'order-created-trigger-workflow'", async () => {
    const { default: executor } = await import(executorPath);
    expect(executor.name).toBe("order-created-trigger-workflow");
  });

  test("executor has a non-empty description", async () => {
    const { default: executor } = await import(executorPath);
    expect(executor.description).toBeDefined();
    expect(typeof executor.description).toBe("string");
    expect(executor.description.length).toBeGreaterThan(0);
  });

  test("trigger kind is 'recordCreated'", async () => {
    const { default: executor } = await import(executorPath);
    expect(executor.trigger).toBeDefined();
    expect(executor.trigger.kind).toBe("recordCreated");
  });

  test("operation kind is 'workflow'", async () => {
    const { default: executor } = await import(executorPath);
    expect(executor.operation).toBeDefined();
    expect(executor.operation.kind).toBe("workflow");
  });

  test("operation has workflow property defined", async () => {
    const { default: executor } = await import(executorPath);
    expect(executor.operation.workflow).toBeDefined();
  });

  test("operation has args property", async () => {
    const { default: executor } = await import(executorPath);
    expect(executor.operation.args).toBeDefined();
  });
});
