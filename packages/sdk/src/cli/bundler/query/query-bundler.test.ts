import * as fs from "node:fs";
import * as path from "pathe";
import { resolveTSConfig } from "pkg-types";
import { aroundAll, aroundEach, describe, expect, test, vi } from "vitest";
import { bundleQueryScript } from "./query-bundler";
import type * as pkgTypes from "pkg-types";

type PkgTypesModule = typeof pkgTypes;

vi.mock("pkg-types", async (importOriginal) => {
  const original = await importOriginal<PkgTypesModule>();
  return { ...original, resolveTSConfig: vi.fn(async () => undefined) };
});

const TEST_BUNDLER_BASE = path.join(__dirname, "__test_bundler__");

describe("query-bundler", () => {
  aroundEach(async (runTest) => {
    const testDir = path.join(
      TEST_BUNDLER_BASE,
      `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    fs.mkdirSync(testDir, { recursive: true });
    process.env.TAILOR_BUILD_OUTPUT_DIR = testDir;
    await runTest();
  });

  aroundAll(async (runSuite) => {
    await runSuite();
    delete process.env.TAILOR_BUILD_OUTPUT_DIR;
    try {
      fs.rmSync(TEST_BUNDLER_BASE, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("bundleQueryScript", () => {
    test("resolves tsconfig from the provided baseDir", async () => {
      vi.mocked(resolveTSConfig).mockClear();
      await bundleQueryScript(__dirname);

      expect(resolveTSConfig).toHaveBeenCalledWith(__dirname);
    });

    test("bundles SQL query script with expected runtime pieces", async () => {
      const bundledCode = await bundleQueryScript(__dirname);

      expect(bundledCode).toContain("export");
      expect(bundledCode).toContain("main");
      expect(bundledCode).toContain("sql.raw");
      expect(bundledCode).toContain("Kysely");
      expect(bundledCode).toContain("TailordbDialect");
      expect(bundledCode).toContain("new tailordb.Client");
      expect(bundledCode).toContain("rowCount");
    });

    test("writes the entry file to query output directory (bundle output is in-memory only)", async () => {
      const outputDir = path.join(process.env.TAILOR_BUILD_OUTPUT_DIR!, "query");

      await bundleQueryScript(__dirname);

      // Entry files are still written to disk (rolldown input)
      expect(fs.existsSync(path.join(outputDir, "query_sql.entry.ts"))).toBe(true);

      // Bundle output files are NOT written (write: false)
      expect(fs.existsSync(path.join(outputDir, "query_sql.js"))).toBe(false);

      const sqlEntry = fs.readFileSync(path.join(outputDir, "query_sql.entry.ts"), "utf-8");

      expect(sqlEntry).toContain("sql.raw(query).execute");
      expect(sqlEntry).toContain("new tailordb.Client");
    });
  });
});
