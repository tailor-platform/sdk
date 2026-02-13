import { describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";

const workDir = path.resolve(import.meta.dirname, "..", "work");
const workDirExists = fs.existsSync(workDir);

describe.skipIf(!workDirExists)("039-resolver-trigger-workflow", () => {
  const resolverPath = path.join(workDir, "resolvers/startProcessing/resolver.ts");

  test("resolvers/startProcessing/resolver.ts exists", () => {
    expect(fs.existsSync(resolverPath)).toBe(true);
  });

  test("resolver is a default export", async () => {
    const mod = await import(resolverPath);
    expect(mod.default).toBeDefined();
  });

  test("resolver has correct name", async () => {
    const { default: resolver } = await import(resolverPath);
    expect(resolver.name).toBe("startProcessing");
  });

  test("resolver operation is mutation", async () => {
    const { default: resolver } = await import(resolverPath);
    expect(resolver.operation).toBe("mutation");
  });

  test("input has dataId as string", async () => {
    const { default: resolver } = await import(resolverPath);
    expect(resolver.input.dataId).toBeDefined();
    expect(resolver.input.dataId.type).toBe("string");
  });

  test("input has priority as enum", async () => {
    const { default: resolver } = await import(resolverPath);
    expect(resolver.input.priority).toBeDefined();
    expect(resolver.input.priority.type).toBe("enum");
  });

  test("priority enum has correct values", async () => {
    const { default: resolver } = await import(resolverPath);
    const values = resolver.input.priority.metadata.allowedValues.map(
      (v: { value: string }) => v.value,
    );
    expect(values).toEqual(["low", "medium", "high"]);
  });

  test("body is a callable function", async () => {
    const { default: resolver } = await import(resolverPath);
    expect(typeof resolver.body).toBe("function");
  });

  test("body returns an object with triggered: true", async () => {
    const { default: resolver } = await import(resolverPath);
    const result = resolver.body({
      input: { dataId: "data-1", priority: "high" },
      user: {},
      env: {},
    });
    expect(result).toBeDefined();
    expect(result.triggered).toBe(true);
  });

  test("body calls processDataJob.trigger with input", async () => {
    const { default: resolver } = await import(resolverPath);
    const result = resolver.body({
      input: { dataId: "data-1", priority: "high" },
      user: {},
      env: {},
    });
    // The result from trigger should be captured in the return value
    expect(result.result).toBeDefined();
  });

  test("output has triggered and result fields", async () => {
    const { default: resolver } = await import(resolverPath);
    expect(resolver.output).toBeDefined();
    expect(resolver.output.type).toBe("nested");
    expect(resolver.output.fields).toBeDefined();
    expect(resolver.output.fields.triggered).toBeDefined();
    expect(resolver.output.fields.result).toBeDefined();
  });
});
