import { describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";

const workDir = path.resolve(import.meta.dirname, "..", "work");
const workDirExists = fs.existsSync(workDir);

describe.skipIf(!workDirExists)("003-multi-pattern-resolvers", () => {
  // ─── calculator ───────────────────────────────────────────────────────

  describe("calculator resolver", () => {
    const resolverPath = path.join(workDir, "resolvers/calculator.ts");

    test("has default export with correct name and operation", async () => {
      const mod = await import(resolverPath);
      const resolver = mod.default;
      expect(resolver).toBeDefined();
      expect(resolver.name).toBe("calculator");
      expect(resolver.operation).toBe("query");
    });

    test("body computes sum and product for positive integers", async () => {
      const { default: resolver } = await import(resolverPath);
      const result = resolver.body({ input: { a: 3, b: 4 }, user: {}, env: {} });
      expect(result).toEqual({ sum: 7, product: 12 });
    });

    test("body handles negative values", async () => {
      const { default: resolver } = await import(resolverPath);
      const result = resolver.body({ input: { a: -3, b: 7 }, user: {}, env: {} });
      expect(result).toEqual({ sum: 4, product: -21 });
    });

    test("body handles zero values", async () => {
      const { default: resolver } = await import(resolverPath);
      const result = resolver.body({ input: { a: 0, b: 5 }, user: {}, env: {} });
      expect(result).toEqual({ sum: 5, product: 0 });
    });

    test("body handles both negative values", async () => {
      const { default: resolver } = await import(resolverPath);
      const result = resolver.body({ input: { a: -2, b: -3 }, user: {}, env: {} });
      expect(result).toEqual({ sum: -5, product: 6 });
    });

    test("output has integer sum and product fields", async () => {
      const { default: resolver } = await import(resolverPath);
      expect(resolver.output.type).toBe("nested");
      expect(resolver.output.fields.sum.type).toBe("integer");
      expect(resolver.output.fields.product.type).toBe("integer");
    });
  });

  // ─── formatName ──────────────────────────────────────────────────────

  describe("formatName resolver", () => {
    const resolverPath = path.join(workDir, "resolvers/formatName.ts");

    test("has default export with correct name and operation", async () => {
      const mod = await import(resolverPath);
      const resolver = mod.default;
      expect(resolver).toBeDefined();
      expect(resolver.name).toBe("formatName");
      expect(resolver.operation).toBe("mutation");
    });

    test("body formats name without uppercase", async () => {
      const { default: resolver } = await import(resolverPath);
      const result = resolver.body({
        input: { firstName: "John", lastName: "Doe" },
        user: {},
        env: {},
      });
      expect(result).toEqual({ fullName: "John Doe", initials: "JD" });
    });

    test("body formats name with uppercase true", async () => {
      const { default: resolver } = await import(resolverPath);
      const result = resolver.body({
        input: { firstName: "Jane", lastName: "Smith", uppercase: true },
        user: {},
        env: {},
      });
      expect(result).toEqual({ fullName: "JANE SMITH", initials: "JS" });
    });

    test("body formats name with uppercase false", async () => {
      const { default: resolver } = await import(resolverPath);
      const result = resolver.body({
        input: { firstName: "John", lastName: "Doe", uppercase: false },
        user: {},
        env: {},
      });
      expect(result).toEqual({ fullName: "John Doe", initials: "JD" });
    });

    test("initials are always uppercase regardless of input case", async () => {
      const { default: resolver } = await import(resolverPath);
      const result = resolver.body({
        input: { firstName: "john", lastName: "doe" },
        user: {},
        env: {},
      });
      expect(result.initials).toBe("JD");
    });

    test("uppercase is optional", async () => {
      const { default: resolver } = await import(resolverPath);
      expect(resolver.input.uppercase.metadata.required).toBe(false);
    });
  });

  // ─── categorizeNumbers ───────────────────────────────────────────────

  describe("categorizeNumbers resolver", () => {
    const resolverPath = path.join(workDir, "resolvers/categorizeNumbers.ts");

    test("has default export with correct name and operation", async () => {
      const mod = await import(resolverPath);
      const resolver = mod.default;
      expect(resolver).toBeDefined();
      expect(resolver.name).toBe("categorizeNumbers");
      expect(resolver.operation).toBe("query");
    });

    test("body categorizes mixed input correctly", async () => {
      const { default: resolver } = await import(resolverPath);
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

    test("body returns all_positive for positive numbers", async () => {
      const { default: resolver } = await import(resolverPath);
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

    test("body returns all_negative for negative numbers", async () => {
      const { default: resolver } = await import(resolverPath);
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

    test("body returns empty for empty array", async () => {
      const { default: resolver } = await import(resolverPath);
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

    test("body returns mixed for zeros only", async () => {
      const { default: resolver } = await import(resolverPath);
      const result = resolver.body({
        input: { numbers: [0] },
        user: {},
        env: {},
      });
      expect(result.zeros).toBe(1);
      expect(result.summary).toBe("mixed");
    });

    test("output summary is an enum type", async () => {
      const { default: resolver } = await import(resolverPath);
      expect(resolver.output.fields.summary.type).toBe("enum");
    });
  });

  // ─── whoami ──────────────────────────────────────────────────────────

  describe("whoami resolver", () => {
    const resolverPath = path.join(workDir, "resolvers/whoami/resolver.ts");

    test("has default export with correct name and operation", async () => {
      const mod = await import(resolverPath);
      const resolver = mod.default;
      expect(resolver).toBeDefined();
      expect(resolver.name).toBe("whoami");
      expect(resolver.operation).toBe("query");
    });

    test("resolver has no input", async () => {
      const { default: resolver } = await import(resolverPath);
      expect(
        resolver.input === undefined ||
          resolver.input === null ||
          Object.keys(resolver.input).length === 0,
      ).toBe(true);
    });

    test("body returns correct user info from context", async () => {
      const { default: resolver } = await import(resolverPath);
      const result = resolver.body({
        input: {},
        user: {
          id: "user-123",
          type: "user",
          workspaceId: "ws-1",
          attributes: { role: "admin" },
          attributeList: [],
        },
        env: {},
      });
      expect(result).toEqual({
        userId: "user-123",
        userType: "user",
        attributes: { role: "admin" },
      });
    });

    test("body handles machine user context", async () => {
      const { default: resolver } = await import(resolverPath);
      const result = resolver.body({
        input: {},
        user: {
          id: "machine-456",
          type: "machine_user",
          workspaceId: "ws-2",
          attributes: { role: "service" },
          attributeList: [],
        },
        env: {},
      });
      expect(result).toEqual({
        userId: "machine-456",
        userType: "machine_user",
        attributes: { role: "service" },
      });
    });

    test("body handles empty attributes", async () => {
      const { default: resolver } = await import(resolverPath);
      const result = resolver.body({
        input: {},
        user: {
          id: "user-789",
          type: "user",
          workspaceId: "ws-3",
          attributes: {},
          attributeList: [],
        },
        env: {},
      });
      expect(result).toEqual({
        userId: "user-789",
        userType: "user",
        attributes: {},
      });
    });

    test("output has userId, userType, and attributes fields", async () => {
      const { default: resolver } = await import(resolverPath);
      expect(resolver.output.type).toBe("nested");
      expect(resolver.output.fields.userId.type).toBe("string");
      expect(resolver.output.fields.userType.type).toBe("string");
      expect(resolver.output.fields.attributes.type).toBe("nested");
    });
  });
});
