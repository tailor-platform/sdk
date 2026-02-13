import { describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";

const workDir = path.resolve(import.meta.dirname, "..", "work");
const workDirExists = fs.existsSync(workDir);

describe.skipIf(!workDirExists)("005-array-resolver", () => {
  test("resolvers/categorizeNumbers.ts exists", () => {
    expect(fs.existsSync(path.join(workDir, "resolvers/categorizeNumbers.ts"))).toBe(true);
  });

  test("resolver has a default export", async () => {
    const mod = await import(path.join(workDir, "resolvers/categorizeNumbers.ts"));
    expect(mod.default).toBeDefined();
  });

  test("resolver has correct name", async () => {
    const mod = await import(path.join(workDir, "resolvers/categorizeNumbers.ts"));
    const resolver = mod.default;
    expect(resolver.name).toBe("categorizeNumbers");
  });

  test("resolver has correct operation", async () => {
    const mod = await import(path.join(workDir, "resolvers/categorizeNumbers.ts"));
    const resolver = mod.default;
    expect(resolver.operation).toBe("query");
  });

  test("resolver input numbers is an array of integers", async () => {
    const mod = await import(path.join(workDir, "resolvers/categorizeNumbers.ts"));
    const resolver = mod.default;
    expect(resolver.input).toBeDefined();
    expect(resolver.input.numbers).toBeDefined();
    expect(resolver.input.numbers.type).toBe("integer");
    expect(resolver.input.numbers.metadata.array).toBe(true);
  });

  test("resolver body correctly categorizes mixed input", async () => {
    const mod = await import(path.join(workDir, "resolvers/categorizeNumbers.ts"));
    const resolver = mod.default;
    const result = resolver.body({
      input: { numbers: [3, -1, 0, 5, -2] },
      user: {},
      env: {},
    });
    expect(result.positives).toEqual([3, 5]);
    expect(result.negatives).toEqual([-1, -2]);
    expect(result.zeros).toBe(1);
    expect(result.summary).toBe("mixed");
  });

  test("resolver body returns all_positive for positive numbers", async () => {
    const mod = await import(path.join(workDir, "resolvers/categorizeNumbers.ts"));
    const resolver = mod.default;
    const result = resolver.body({
      input: { numbers: [1, 2, 3] },
      user: {},
      env: {},
    });
    expect(result.positives).toEqual([1, 2, 3]);
    expect(result.negatives).toEqual([]);
    expect(result.zeros).toBe(0);
    expect(result.summary).toBe("all_positive");
  });

  test("resolver body returns all_negative for negative numbers", async () => {
    const mod = await import(path.join(workDir, "resolvers/categorizeNumbers.ts"));
    const resolver = mod.default;
    const result = resolver.body({
      input: { numbers: [-1, -2, -3] },
      user: {},
      env: {},
    });
    expect(result.positives).toEqual([]);
    expect(result.negatives).toEqual([-1, -2, -3]);
    expect(result.zeros).toBe(0);
    expect(result.summary).toBe("all_negative");
  });

  test("resolver body returns empty for empty array", async () => {
    const mod = await import(path.join(workDir, "resolvers/categorizeNumbers.ts"));
    const resolver = mod.default;
    const result = resolver.body({
      input: { numbers: [] },
      user: {},
      env: {},
    });
    expect(result.positives).toEqual([]);
    expect(result.negatives).toEqual([]);
    expect(result.zeros).toBe(0);
    expect(result.summary).toBe("empty");
  });

  test("resolver body returns mixed for zeros only", async () => {
    const mod = await import(path.join(workDir, "resolvers/categorizeNumbers.ts"));
    const resolver = mod.default;
    const result = resolver.body({
      input: { numbers: [0] },
      user: {},
      env: {},
    });
    expect(result.positives).toEqual([]);
    expect(result.negatives).toEqual([]);
    expect(result.zeros).toBe(1);
    expect(result.summary).toBe("mixed");
  });

  test("resolver output has correct fields", async () => {
    const mod = await import(path.join(workDir, "resolvers/categorizeNumbers.ts"));
    const resolver = mod.default;
    expect(resolver.output).toBeDefined();
    expect(resolver.output.type).toBe("nested");
    expect(resolver.output.fields).toBeDefined();
    expect(resolver.output.fields.positives).toBeDefined();
    expect(resolver.output.fields.positives.type).toBe("integer");
    expect(resolver.output.fields.positives.metadata.array).toBe(true);
    expect(resolver.output.fields.negatives).toBeDefined();
    expect(resolver.output.fields.negatives.type).toBe("integer");
    expect(resolver.output.fields.negatives.metadata.array).toBe(true);
    expect(resolver.output.fields.zeros).toBeDefined();
    expect(resolver.output.fields.zeros.type).toBe("integer");
    expect(resolver.output.fields.summary).toBeDefined();
    expect(resolver.output.fields.summary.type).toBe("enum");
  });
});
