import { describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";

const workDir = path.resolve(import.meta.dirname, "..", "work");
const workDirExists = fs.existsSync(workDir);

describe.skipIf(!workDirExists)("040-webhook-executor-with-secret", () => {
  const executorPath = path.join(workDir, "executors/notifyExternal.ts");

  test("executors/notifyExternal.ts exists", () => {
    expect(fs.existsSync(executorPath)).toBe(true);
  });

  test("executor is a default export", async () => {
    const mod = await import(executorPath);
    expect(mod.default).toBeDefined();
  });

  test("executor has correct name", async () => {
    const { default: executor } = await import(executorPath);
    expect(executor.name).toBe("notify-external-service");
  });

  test("executor has a description", async () => {
    const { default: executor } = await import(executorPath);
    expect(executor.description).toBeDefined();
    expect(typeof executor.description).toBe("string");
    expect(executor.description.length).toBeGreaterThan(0);
  });

  test("trigger kind is recordCreated", async () => {
    const { default: executor } = await import(executorPath);
    expect(executor.trigger).toBeDefined();
    expect(executor.trigger.kind).toBe("recordCreated");
  });

  test("operation kind is webhook", async () => {
    const { default: executor } = await import(executorPath);
    expect(executor.operation).toBeDefined();
    expect(executor.operation.kind).toBe("webhook");
  });

  test("operation url is a function", async () => {
    const { default: executor } = await import(executorPath);
    expect(typeof executor.operation.url).toBe("function");
  });

  test("operation requestBody is a function", async () => {
    const { default: executor } = await import(executorPath);
    expect(typeof executor.operation.requestBody).toBe("function");
  });

  test("operation has headers", async () => {
    const { default: executor } = await import(executorPath);
    expect(executor.operation.headers).toBeDefined();
  });

  test("headers has Content-Type set to application/json", async () => {
    const { default: executor } = await import(executorPath);
    expect(executor.operation.headers["Content-Type"]).toBe("application/json");
  });

  test("headers has Authorization as vault secret object", async () => {
    const { default: executor } = await import(executorPath);
    const auth = executor.operation.headers.Authorization;
    expect(auth).toBeDefined();
    expect(typeof auth).toBe("object");
    expect(auth.vault).toBe("api-secrets");
    expect(auth.key).toBe("external-api-token");
  });
});
