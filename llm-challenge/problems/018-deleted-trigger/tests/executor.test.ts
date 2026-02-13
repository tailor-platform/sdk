import { describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";

const workDir = path.resolve(import.meta.dirname, "..", "work");
const workDirExists = fs.existsSync(workDir);

describe.skipIf(!workDirExists)("018-deleted-trigger", () => {
  const executorPath = path.join(workDir, "executors/taskDeleted.ts");

  test("executors/taskDeleted.ts exists", () => {
    expect(fs.existsSync(executorPath)).toBe(true);
  });

  test("executor is a default export", async () => {
    const mod = await import(executorPath);
    expect(mod.default).toBeDefined();
  });

  test("executor has correct name", async () => {
    const { default: executor } = await import(executorPath);
    expect(executor.name).toBe("task-deleted");
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

  test("trigger is a recordDeleted trigger", async () => {
    const { default: executor } = await import(executorPath);
    expect(executor.trigger.kind).toBe("recordDeleted");
  });

  test("trigger references the Task type", async () => {
    const { default: executor } = await import(executorPath);
    expect(executor.trigger.typeName).toBe("Task");
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
