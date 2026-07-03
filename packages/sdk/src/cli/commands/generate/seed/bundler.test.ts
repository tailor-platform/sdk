import * as fs from "node:fs";
import * as path from "pathe";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { bundleSeedScript } from "./bundler";

const TEST_BUNDLER_BASE = path.join(__dirname, "__test_bundler__");

describe("seed-bundler", () => {
  beforeEach(() => {
    // Set TAILOR_SDK_OUTPUT_DIR to test directory so bundled output goes into test directory
    const testDir = path.join(
      TEST_BUNDLER_BASE,
      `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    fs.mkdirSync(testDir, { recursive: true });
    process.env.TAILOR_SDK_OUTPUT_DIR = testDir;
  });

  afterAll(() => {
    delete process.env.TAILOR_SDK_OUTPUT_DIR;
    try {
      fs.rmSync(TEST_BUNDLER_BASE, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("bundleSeedScript", () => {
    test("returns correct namespace and typesIncluded", async () => {
      const result = await bundleSeedScript("tailordb", ["User", "Order"]);

      expect(result.namespace).toBe("tailordb");
      expect(result.typesIncluded).toEqual(["User", "Order"]);
      expect(typeof result.bundledCode).toBe("string");
    });

    test.each([
      ["exported main function", "tailordb", ["User"], ["export", "main"]],
      ["Kysely and TailordbDialect", "tailordb", ["User"], ["Kysely", "TailordbDialect"]],
      ["batch insert logic", "tailordb", ["User"], ["insertInto", "BATCH_SIZE"]],
      ["error handling", "tailordb", ["User"], ["errors", "success"]],
      ["self-referencing FK handling", "tailordb", ["Category"], ["selfRefTypes", "one-by-one"]],
    ] as const)("generates code with %s", async (_label, namespace, types, snippets) => {
      const result = await bundleSeedScript(namespace, [...types]);

      for (const snippet of snippets) {
        expect(result.bundledCode).toContain(snippet);
      }
    });

    test("generates code with getDB using the correct namespace", async () => {
      const result = await bundleSeedScript("custom-namespace", ["Event"]);

      expect(result.bundledCode).toContain("getDB");
      expect(result.bundledCode).toContain('"custom-namespace"');
    });
  });
});
