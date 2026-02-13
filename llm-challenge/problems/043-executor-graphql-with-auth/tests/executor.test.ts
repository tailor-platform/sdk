import { describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";

const workDir = path.resolve(import.meta.dirname, "..", "work");
const workDirExists = fs.existsSync(workDir);

describe.skipIf(!workDirExists)("043-executor-graphql-with-auth", () => {
  const executorPath = path.join(workDir, "executors/syncData.ts");

  test("executors/syncData.ts exists", () => {
    expect(fs.existsSync(executorPath)).toBe(true);
  });

  test("has default export", async () => {
    const mod = await import(executorPath);
    expect(mod.default).toBeDefined();
  });

  test("executor name is 'sync-product-data'", async () => {
    const { default: executor } = await import(executorPath);
    expect(executor.name).toBe("sync-product-data");
  });

  test("executor has a non-empty description", async () => {
    const { default: executor } = await import(executorPath);
    expect(executor.description).toBeDefined();
    expect(typeof executor.description).toBe("string");
    expect(executor.description.length).toBeGreaterThan(0);
  });

  test("trigger exists and kind is 'resolverExecuted'", async () => {
    const { default: executor } = await import(executorPath);
    expect(executor.trigger).toBeDefined();
    expect(executor.trigger.kind).toBe("resolverExecuted");
  });

  test("trigger has condition function", async () => {
    const { default: executor } = await import(executorPath);
    expect(typeof executor.trigger.condition).toBe("function");
  });

  test("operation kind is 'graphql'", async () => {
    const { default: executor } = await import(executorPath);
    expect(executor.operation).toBeDefined();
    expect(executor.operation.kind).toBe("graphql");
  });

  test("operation has appName property", async () => {
    const { default: executor } = await import(executorPath);
    expect(executor.operation.appName).toBeDefined();
    expect(typeof executor.operation.appName).toBe("string");
  });

  test("operation has query containing 'syncProduct'", async () => {
    const { default: executor } = await import(executorPath);
    expect(typeof executor.operation.query).toBe("string");
    expect(executor.operation.query).toMatch(/syncProduct/i);
  });

  test("operation has variables function", async () => {
    const { default: executor } = await import(executorPath);
    expect(typeof executor.operation.variables).toBe("function");
  });

  test("operation has authInvoker object", async () => {
    const { default: executor } = await import(executorPath);
    expect(executor.operation.authInvoker).toBeDefined();
    expect(typeof executor.operation.authInvoker).toBe("object");
  });

  test("authInvoker has namespace and machineUserName", async () => {
    const { default: executor } = await import(executorPath);
    const { authInvoker } = executor.operation;
    expect(authInvoker.namespace).toBeDefined();
    expect(typeof authInvoker.namespace).toBe("string");
    expect(authInvoker.machineUserName).toBeDefined();
    expect(typeof authInvoker.machineUserName).toBe("string");
  });
});
