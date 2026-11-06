import * as fs from "node:fs";
import * as path from "pathe";
import { resolveTSConfig } from "pkg-types";
import { afterEach, aroundAll, aroundEach, describe, expect, test, vi } from "vitest";
import { bundleQueryScript } from "./query-bundler";
import type { TailordbQueryResult } from "#/runtime/index";
import type * as pkgTypes from "pkg-types";

type PkgTypesModule = typeof pkgTypes;
type QueryObjectResult = TailordbQueryResult<Record<string, unknown>>;

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
      await bundleQueryScript("sql", __dirname);

      expect(resolveTSConfig).toHaveBeenCalledWith(__dirname);
    });

    test("bundles SQL query script with expected runtime pieces", async () => {
      const bundledCode = await bundleQueryScript("sql", __dirname);

      expect(bundledCode).toContain("export");
      expect(bundledCode).toContain("main");
      expect(bundledCode).toContain("Kysely");
      expect(bundledCode).toContain("new tailordb.Client");
      expect(bundledCode).toContain("rowCount");
    });

    test("bundles GraphQL query script with fetch and error handling", async () => {
      const bundledCode = await bundleQueryScript("gql", __dirname);

      expect(bundledCode).toContain("export");
      expect(bundledCode).toContain("main");
      expect(bundledCode).toContain("fetch");
      expect(bundledCode).toContain("Authorization");
      expect(bundledCode).toContain("GraphQL request failed");
    });

    test("keeps SQL and GraphQL runtime concerns separated", async () => {
      const sqlBundle = await bundleQueryScript("sql", __dirname);
      const gqlBundle = await bundleQueryScript("gql", __dirname);

      expect(sqlBundle).toContain("tailordb.Client");
      expect(sqlBundle).toContain("Kysely");
      expect(sqlBundle).not.toContain("GraphQL request failed");

      expect(gqlBundle).toContain("GraphQL request failed");
      expect(gqlBundle).not.toContain("Kysely");
      expect(gqlBundle).not.toContain("tailordb.Client");
    });

    test("strips annotation comments", async () => {
      const bundledCode = await bundleQueryScript("sql", __dirname);

      expect(bundledCode).not.toContain("@__PURE__");
      expect(bundledCode).not.toContain("@__NO_SIDE_EFFECTS__");
    });

    test("writes entry files to query output directory (bundle output is in-memory only)", async () => {
      const outputDir = path.join(process.env.TAILOR_BUILD_OUTPUT_DIR!, "query");

      await bundleQueryScript("sql", __dirname);
      await bundleQueryScript("gql", __dirname);

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

  describe("SQL query script", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    async function runSqlScript(queryResult: QueryObjectResult): Promise<unknown> {
      vi.stubGlobal("tailordb", {
        Client: class {
          async connect() {}
          async end() {}
          async queryObject() {
            return queryResult;
          }
        },
      });
      const modulePath = path.join(process.env.TAILOR_BUILD_OUTPUT_DIR!, "query-sql.mjs");
      fs.writeFileSync(modulePath, await bundleQueryScript("sql", __dirname));
      const { main } = (await import(/* @vite-ignore */ modulePath)) as {
        main: (input: { namespace: string; queries: string[] }) => Promise<unknown>;
      };
      const result = await main({ namespace: "tailordb", queries: ["statement"] });
      return JSON.parse(JSON.stringify(result));
    }

    test.each<[string, QueryObjectResult, unknown]>([
      [
        "write without RETURNING",
        { rows: [], command: "UPDATE", rowCount: 3 },
        { rows: [], rowCount: 3, affectedRows: 3 },
      ],
      [
        "write with RETURNING",
        { rows: [{ id: "1" }], command: "DELETE", rowCount: 1 },
        { rows: [{ id: "1" }], rowCount: 1, affectedRows: 1 },
      ],
      [
        "write matching no rows",
        { rows: [], command: "INSERT", rowCount: 0 },
        { rows: [], rowCount: 0, affectedRows: 0 },
      ],
      [
        "read",
        { rows: [{ id: "1" }, { id: "2" }], command: "SELECT", rowCount: 2 },
        { rows: [{ id: "1" }, { id: "2" }], rowCount: 2 },
      ],
    ])("reports the row count of a %s", async (_label, queryResult, expected) => {
      expect(await runSqlScript(queryResult)).toStrictEqual(expected);
    });
  });
});
