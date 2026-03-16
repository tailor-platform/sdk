import * as fs from "node:fs";
import * as path from "pathe";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
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
    it("returns correct namespace and typesIncluded", async () => {
      const result = await bundleSeedScript("tailordb", ["User", "Order"]);

      expect(result.namespace).toBe("tailordb");
      expect(result.typesIncluded).toEqual(["User", "Order"]);
      expect(typeof result.bundledCode).toBe("string");
    });

    it("generates code with exported main function", async () => {
      const result = await bundleSeedScript("tailordb", ["User"]);

      expect(result.bundledCode).toContain("export");
      expect(result.bundledCode).toContain("main");
    });

    it("generates code with getDB using the correct namespace", async () => {
      const result = await bundleSeedScript("custom-namespace", ["Event"]);

      expect(result.bundledCode).toContain("getDB");
      expect(result.bundledCode).toContain('"custom-namespace"');
    });

    it("generates code with Kysely and TailordbDialect", async () => {
      const result = await bundleSeedScript("tailordb", ["User"]);

      expect(result.bundledCode).toContain("Kysely");
      expect(result.bundledCode).toContain("TailordbDialect");
    });

    it("generates code with batch insert logic", async () => {
      const result = await bundleSeedScript("tailordb", ["User"]);

      expect(result.bundledCode).toContain("insertInto");
      expect(result.bundledCode).toContain("BATCH_SIZE");
    });

    it("generates code with error handling", async () => {
      const result = await bundleSeedScript("tailordb", ["User"]);

      expect(result.bundledCode).toContain("errors");
      expect(result.bundledCode).toContain("success");
    });

    it("generates code with self-referencing FK handling", async () => {
      const result = await bundleSeedScript("tailordb", ["Category"]);

      expect(result.bundledCode).toContain("selfRefTypes");
      expect(result.bundledCode).toContain("one-by-one");
    });

    it("should import from @tailor-platform/sdk/kysely instead of kysely directly", async () => {
      await bundleSeedScript("tailordb", ["User"]);

      // Read the generated entry file to verify it uses the SDK re-export
      const outputDir = path.join(process.env.TAILOR_SDK_OUTPUT_DIR!, "seed");
      const entryPath = path.join(outputDir, "seed_tailordb.entry.ts");
      const entryContent = fs.readFileSync(entryPath, "utf-8");

      // The entry script should use the SDK re-export, not direct kysely import
      // This ensures seed works without users installing kysely as a direct dependency
      expect(entryContent).not.toMatch(/from\s+["']kysely["']/);
      expect(entryContent).not.toMatch(/from\s+["']@tailor-platform\/function-kysely-tailordb["']/);
      expect(entryContent).toMatch(/from\s+["']@tailor-platform\/sdk\/kysely["']/);
    });
  });
});
