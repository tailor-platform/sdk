import * as fs from "node:fs";
import * as path from "pathe";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bundleQueryScript } from "./query-bundler";

const TEST_BUNDLER_BASE = path.join(__dirname, "__test_bundler__");

describe("query-bundler", () => {
  beforeEach(() => {
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

  describe("bundleQueryScript", () => {
    it("bundles SQL query script with expected runtime pieces", async () => {
      const bundledCode = await bundleQueryScript("sql");

      expect(bundledCode).toContain("export");
      expect(bundledCode).toContain("main");
      expect(bundledCode).toContain("sql.raw");
      expect(bundledCode).toContain("Kysely");
      expect(bundledCode).toContain("TailordbDialect");
      expect(bundledCode).toContain("new tailordb.Client");
      expect(bundledCode).toContain("rowCount");
    });

    it("bundles GraphQL query script with fetch and error handling", async () => {
      const bundledCode = await bundleQueryScript("gql");

      expect(bundledCode).toContain("export");
      expect(bundledCode).toContain("main");
      expect(bundledCode).toContain("fetch");
      expect(bundledCode).toContain("Authorization");
      expect(bundledCode).toContain("GraphQL request failed");
      expect(bundledCode).toContain("response.ok");
    });

    it("keeps SQL and GraphQL runtime concerns separated", async () => {
      const sqlBundle = await bundleQueryScript("sql");
      const gqlBundle = await bundleQueryScript("gql");

      expect(sqlBundle).toContain("tailordb.Client");
      expect(sqlBundle).toContain("TailordbDialect");
      expect(sqlBundle).toContain("sql.raw(query).execute");
      expect(sqlBundle).not.toContain("fetch(input.endpoint");

      expect(gqlBundle).toContain("fetch(input.endpoint");
      expect(gqlBundle).not.toContain("TailordbDialect");
      expect(gqlBundle).not.toContain("tailordb.Client");
    });

    it("writes entry files to query output directory (bundle output is in-memory only)", async () => {
      const outputDir = path.join(process.env.TAILOR_SDK_OUTPUT_DIR!, "query");

      await bundleQueryScript("sql");
      await bundleQueryScript("gql");

      // Entry files are still written to disk (rolldown input)
      expect(fs.existsSync(path.join(outputDir, "query_sql.entry.ts"))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, "query_gql.entry.ts"))).toBe(true);

      // Bundle output files are NOT written (write: false)
      expect(fs.existsSync(path.join(outputDir, "query_sql.js"))).toBe(false);
      expect(fs.existsSync(path.join(outputDir, "query_gql.js"))).toBe(false);

      const sqlEntry = fs.readFileSync(path.join(outputDir, "query_sql.entry.ts"), "utf-8");
      const gqlEntry = fs.readFileSync(path.join(outputDir, "query_gql.entry.ts"), "utf-8");

      expect(sqlEntry).toContain("sql.raw(query).execute");
      expect(sqlEntry).toContain("new tailordb.Client");
      expect(gqlEntry).toContain("fetch(input.endpoint");
      expect(gqlEntry).toContain("GraphQL request failed");
    });
  });
});
