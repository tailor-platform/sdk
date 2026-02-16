import { describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { importPath } from "../../../shared/helpers.js";

const workDir = path.resolve(import.meta.dirname, "..", "work");
const workDirReady = fs.existsSync(path.join(workDir, "node_modules"));

describe.skipIf(!workDirReady)("005-record-lifecycle-executors", () => {
  const productCreatedPath = path.join(workDir, "executors/productCreated.ts");
  const orderStatusChangedPath = path.join(workDir, "executors/orderStatusChanged.ts");
  const taskDeletedPath = path.join(workDir, "executors/taskDeleted.ts");
  const logResolverPath = path.join(workDir, "executors/logResolverExecution.ts");

  // --- File existence ---

  test("all 4 executor files exist", () => {
    expect(fs.existsSync(productCreatedPath)).toBe(true);
    expect(fs.existsSync(orderStatusChangedPath)).toBe(true);
    expect(fs.existsSync(taskDeletedPath)).toBe(true);
    expect(fs.existsSync(logResolverPath)).toBe(true);
  });

  // --- productCreated ---

  test("productCreated is a default export", async () => {
    const mod = await importPath(productCreatedPath);
    expect(mod.default).toBeDefined();
  });

  test("productCreated has correct name", async () => {
    const { default: executor } = await importPath(productCreatedPath);
    expect(executor.name).toBe("product-created");
  });

  test("productCreated has a non-empty description", async () => {
    const { default: executor } = await importPath(productCreatedPath);
    expect(executor.description).toBeDefined();
    expect(typeof executor.description).toBe("string");
    expect(executor.description.length).toBeGreaterThan(0);
  });

  test("productCreated trigger kind is recordCreated", async () => {
    const { default: executor } = await importPath(productCreatedPath);
    expect(executor.trigger.kind).toBe("recordCreated");
  });

  test("productCreated trigger references Product type", async () => {
    const { default: executor } = await importPath(productCreatedPath);
    expect(executor.trigger.typeName).toBe("Product");
  });

  test("productCreated operation is a function", async () => {
    const { default: executor } = await importPath(productCreatedPath);
    expect(executor.operation.kind).toBe("function");
    expect(typeof executor.operation.body).toBe("function");
  });

  // --- orderStatusChanged ---

  test("orderStatusChanged is a default export", async () => {
    const mod = await importPath(orderStatusChangedPath);
    expect(mod.default).toBeDefined();
  });

  test("orderStatusChanged has correct name", async () => {
    const { default: executor } = await importPath(orderStatusChangedPath);
    expect(executor.name).toBe("order-status-changed");
  });

  test("orderStatusChanged trigger kind is recordUpdated", async () => {
    const { default: executor } = await importPath(orderStatusChangedPath);
    expect(executor.trigger.kind).toBe("recordUpdated");
  });

  test("orderStatusChanged trigger references Order type", async () => {
    const { default: executor } = await importPath(orderStatusChangedPath);
    expect(executor.trigger.typeName).toBe("Order");
  });

  test("orderStatusChanged trigger has a condition function", async () => {
    const { default: executor } = await importPath(orderStatusChangedPath);
    expect(typeof executor.trigger.condition).toBe("function");
  });

  test("orderStatusChanged condition returns true when status changes", async () => {
    const { default: executor } = await importPath(orderStatusChangedPath);
    const result = executor.trigger.condition({
      newRecord: { status: "shipped" },
      oldRecord: { status: "pending" },
    });
    expect(result).toBe(true);
  });

  test("orderStatusChanged condition returns false when status is the same", async () => {
    const { default: executor } = await importPath(orderStatusChangedPath);
    const result = executor.trigger.condition({
      newRecord: { status: "pending" },
      oldRecord: { status: "pending" },
    });
    expect(result).toBe(false);
  });

  test("orderStatusChanged operation is a function", async () => {
    const { default: executor } = await importPath(orderStatusChangedPath);
    expect(executor.operation.kind).toBe("function");
    expect(typeof executor.operation.body).toBe("function");
  });

  // --- taskDeleted ---

  test("taskDeleted is a default export", async () => {
    const mod = await importPath(taskDeletedPath);
    expect(mod.default).toBeDefined();
  });

  test("taskDeleted has correct name", async () => {
    const { default: executor } = await importPath(taskDeletedPath);
    expect(executor.name).toBe("task-deleted");
  });

  test("taskDeleted trigger kind is recordDeleted", async () => {
    const { default: executor } = await importPath(taskDeletedPath);
    expect(executor.trigger.kind).toBe("recordDeleted");
  });

  test("taskDeleted trigger references Task type", async () => {
    const { default: executor } = await importPath(taskDeletedPath);
    expect(executor.trigger.typeName).toBe("Task");
  });

  test("taskDeleted operation is a function", async () => {
    const { default: executor } = await importPath(taskDeletedPath);
    expect(executor.operation.kind).toBe("function");
    expect(typeof executor.operation.body).toBe("function");
  });

  // --- logResolverExecution ---

  test("logResolverExecution is a default export", async () => {
    const mod = await importPath(logResolverPath);
    expect(mod.default).toBeDefined();
  });

  test("logResolverExecution has correct name", async () => {
    const { default: executor } = await importPath(logResolverPath);
    expect(executor.name).toBe("log-resolver-execution");
  });

  test("logResolverExecution trigger kind is resolverExecuted", async () => {
    const { default: executor } = await importPath(logResolverPath);
    expect(executor.trigger.kind).toBe("resolverExecuted");
  });

  test("logResolverExecution trigger references getProduct resolver", async () => {
    const { default: executor } = await importPath(logResolverPath);
    expect(executor.trigger.resolverName).toBe("getProduct");
  });

  test("logResolverExecution operation is a function", async () => {
    const { default: executor } = await importPath(logResolverPath);
    expect(executor.operation.kind).toBe("function");
    expect(typeof executor.operation.body).toBe("function");
  });

  test("logResolverExecution body handles success args", async () => {
    const { default: executor } = await importPath(logResolverPath);
    // Should not throw when called with success args
    await expect(
      executor.operation.body({ success: true, result: { id: "1", name: "Test" } }),
    ).resolves.not.toThrow();
  });

  test("logResolverExecution body handles failure args", async () => {
    const { default: executor } = await importPath(logResolverPath);
    // Should not throw when called with failure args
    await expect(
      executor.operation.body({ success: false, error: "Not found" }),
    ).resolves.not.toThrow();
  });
});
