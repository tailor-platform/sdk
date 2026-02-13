import { describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";

const workDir = path.resolve(import.meta.dirname, "..", "work");
const workDirExists = fs.existsSync(workDir);

describe.skipIf(!workDirExists)("035-resolver-executed-trigger", () => {
  const executorPath = path.join(workDir, "executors/logResolverExecution.ts");

  test("executors/logResolverExecution.ts exists", () => {
    expect(fs.existsSync(executorPath)).toBe(true);
  });

  test("executor is a default export", async () => {
    const mod = await import(executorPath);
    expect(mod.default).toBeDefined();
  });

  test("executor name is 'log-resolver-execution'", async () => {
    const { default: executor } = await import(executorPath);
    expect(executor.name).toBe("log-resolver-execution");
  });

  test("executor has a non-empty description", async () => {
    const { default: executor } = await import(executorPath);
    expect(executor.description).toBeDefined();
    expect(typeof executor.description).toBe("string");
    expect(executor.description.length).toBeGreaterThan(0);
  });

  test("trigger exists and has kind 'resolverExecuted'", async () => {
    const { default: executor } = await import(executorPath);
    expect(executor.trigger).toBeDefined();
    expect(executor.trigger.kind).toBe("resolverExecuted");
  });

  test("trigger references the getProduct resolver", async () => {
    const { default: executor } = await import(executorPath);
    expect(executor.trigger.resolverName).toBe("getProduct");
  });

  test("operation kind is 'function'", async () => {
    const { default: executor } = await import(executorPath);
    expect(executor.operation).toBeDefined();
    expect(executor.operation.kind).toBe("function");
  });

  test("operation body is a callable function", async () => {
    const { default: executor } = await import(executorPath);
    expect(typeof executor.operation.body).toBe("function");
  });
});
