import * as fs from "node:fs";
import * as path from "pathe";
import { resolveTSConfig } from "pkg-types";
import { afterAll, afterEach, aroundAll, aroundEach, describe, expect, test, vi } from "vitest";
import { bundleSeedDumpScript, bundleSeedScript } from "./bundler";
import type * as pkgTypes from "pkg-types";

type PkgTypesModule = typeof pkgTypes;

vi.mock("pkg-types", async (importOriginal) => {
  const original = await importOriginal<PkgTypesModule>();
  return { ...original, resolveTSConfig: vi.fn(async () => undefined) };
});

const TEST_BUNDLER_BASE = path.join(__dirname, "__test_bundler__");

type SeedInput = {
  data: Record<string, Record<string, unknown>[]>;
  order: string[];
  selfRefTypes: string[];
  upsert?: boolean;
};

type SeedResult = {
  success: boolean;
  processed: Record<string, { inserted: number; updated: number; skipped: number }>;
  errors: string[];
};

type RecordedQuery = { sql: string; parameters: readonly unknown[] };

/**
 * Install a `tailordb` global that records the SQL the bundled seed script issues.
 * @param existingIds IDs returned by TailorDB's existence probe
 * @returns Queries recorded so far, in execution order
 */
function stubTailordb(existingIds: string[] = []): RecordedQuery[] {
  const queries: RecordedQuery[] = [];
  const existing = new Set(existingIds);
  vi.stubGlobal("tailordb", {
    Client: class {
      async connect() {}
      async end() {}
      async queryObject(sql: string, parameters: readonly unknown[]) {
        queries.push({ sql, parameters });
        if (sql.startsWith("select")) {
          const rows = parameters
            .filter((parameter): parameter is string => typeof parameter === "string")
            .filter((id) => existing.has(id))
            .map((id) => ({ id }));
          return { rows, command: "SELECT", rowCount: rows.length };
        }
        return { rows: [], command: "INSERT", rowCount: 1 };
      }
    },
  });
  return queries;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => {
  fs.rmSync(TEST_BUNDLER_BASE, { recursive: true, force: true });
});

describe("seed-bundler", () => {
  aroundEach(async (runTest) => {
    // Set TAILOR_BUILD_OUTPUT_DIR to test directory so bundled output goes into test directory
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

    test("resolves the tsconfig from the provided project directory", async () => {
      const projectDir = path.join(TEST_BUNDLER_BASE, "project");
      fs.mkdirSync(projectDir, { recursive: true });
      vi.mocked(resolveTSConfig).mockClear();

      await bundleSeedScript("tailordb", ["User"], projectDir);

      expect(resolveTSConfig).toHaveBeenCalledWith(projectDir);
    });

    test("generates split insert and update logic gated on the runtime upsert input", async () => {
      const result = await bundleSeedScript("tailordb", ["User"]);

      expect(result.bundledCode).toContain("selectFrom");
      expect(result.bundledCode).toContain("updateTable");
      expect(result.bundledCode).toContain("upsert");
    });

    test("probes and updates by id", async () => {
      const result = await bundleSeedScript("tailordb", ["User"]);

      expect(result.bundledCode).toContain('select("id")');
      expect(result.bundledCode).toContain('where("id", "in"');
      expect(result.bundledCode).toContain('where("id", "="');
    });
  });
});

describe("seed script upsert behavior", () => {
  const loadMain = async (namespace: string, tableNames: string[]) => {
    const { bundledCode } = await bundleSeedScript(namespace, tableNames);
    const modulePath = path.join(
      process.env.TAILOR_BUILD_OUTPUT_DIR as string,
      `main-${namespace}.mjs`,
    );
    fs.writeFileSync(modulePath, bundledCode);
    return (await import(/* @vite-ignore */ modulePath)) as {
      main: (input: SeedInput) => Promise<SeedResult>;
    };
  };

  aroundEach(async (runTest) => {
    const testDir = path.join(
      TEST_BUNDLER_BASE,
      `upsert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    fs.mkdirSync(testDir, { recursive: true });
    process.env.TAILOR_BUILD_OUTPUT_DIR = testDir;
    await runTest();
  });

  aroundAll(async (runSuite) => {
    await runSuite();
    delete process.env.TAILOR_BUILD_OUTPUT_DIR;
  });

  test("inserts new rows and updates existing rows when upsert is enabled", async () => {
    const queries = stubTailordb(["u2"]);
    const { main } = await loadMain("tailordb", ["User"]);

    const result = await main({
      data: {
        User: [
          { id: "u1", name: "Alice" },
          { id: "u2", name: "Bob" },
        ],
      },
      order: ["User"],
      selfRefTypes: [],
      upsert: true,
    });

    expect(queries.map(({ sql }) => sql.split(" ")[0])).toEqual(["select", "insert", "update"]);
    expect(queries[1]?.parameters).toContain("u1");
    expect(queries[1]?.parameters).not.toContain("u2");
    expect(queries[2]?.parameters).toContain("u2");
    expect(queries.every(({ sql }) => !sql.includes("on conflict"))).toBe(true);
    expect(result.processed.User).toEqual({ inserted: 1, updated: 1, skipped: 0 });
  });

  test("does not probe or update when upsert is disabled", async () => {
    const queries = stubTailordb();
    const { main } = await loadMain("tailordb", ["User"]);

    const result = await main({
      data: { User: [{ id: "u1", name: "Alice" }] },
      order: ["User"],
      selfRefTypes: [],
      upsert: false,
    });

    expect(queries).toHaveLength(1);
    expect(queries[0]?.sql).toMatch(/^insert /);
    expect(result.processed.User).toEqual({ inserted: 1, updated: 0, skipped: 0 });
  });

  test("reports progress after each batch when upsert is disabled", async () => {
    const queries = stubTailordb();
    const { main } = await loadMain("tailordb", ["User"]);
    using logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const records = Array.from({ length: 101 }, (_, index) => ({
      id: `u${index + 1}`,
      name: `User ${index + 1}`,
    }));

    const result = await main({
      data: { User: records },
      order: ["User"],
      selfRefTypes: [],
      upsert: false,
    });

    expect(queries).toHaveLength(2);
    expect(logSpy).toHaveBeenNthCalledWith(1, "[tailordb] User: 100/101");
    expect(logSpy).toHaveBeenNthCalledWith(2, "[tailordb] User: 101/101");
    expect(result.processed.User).toEqual({ inserted: 101, updated: 0, skipped: 0 });
  });

  test("updates only columns present in an existing row", async () => {
    const queries = stubTailordb(["u2"]);
    const { main } = await loadMain("tailordb", ["User"]);

    await main({
      data: {
        User: [{ id: "u2", name: "Bob" }],
      },
      order: ["User"],
      selfRefTypes: [],
      upsert: true,
    });

    const update = queries.find(({ sql }) => sql.startsWith("update"));
    const setClause = (update?.sql ?? "").split(" where ")[0];
    expect(setClause).toContain('"name" =');
    expect(setClause).not.toContain('"id" =');
    expect(setClause).not.toContain('"email" =');
  });

  test("counts an id-only existing row as skipped", async () => {
    const queries = stubTailordb(["u1"]);
    const { main } = await loadMain("tailordb", ["User"]);
    using logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await main({
      data: { User: [{ id: "u1" }] },
      order: ["User"],
      selfRefTypes: [],
      upsert: true,
    });

    expect(queries).toHaveLength(1);
    expect(queries[0]?.sql).toMatch(/^select /);
    expect(result.processed.User).toEqual({ inserted: 0, updated: 0, skipped: 1 });
    expect(logSpy).toHaveBeenCalledWith("[tailordb] User: 0 inserted, 0 updated, 1 skipped");
  });

  test("inserts self-referencing types one-by-one after the id probe", async () => {
    const queries = stubTailordb();
    const { main } = await loadMain("tailordb", ["Category"]);

    const result = await main({
      data: {
        Category: [
          { id: "c1", parentId: null },
          { id: "c2", parentId: "c1" },
        ],
      },
      order: ["Category"],
      selfRefTypes: ["Category"],
      upsert: true,
    });

    expect(result.processed.Category).toEqual({ inserted: 2, updated: 0, skipped: 0 });
    expect(queries).toHaveLength(3);
    expect(queries[0]?.sql).toMatch(/^select /);
    expect(queries.slice(1).every(({ sql }) => sql.startsWith("insert"))).toBe(true);
  });
});

type DumpInput = { table: string; limit: number; after?: string | null };

type DumpResult = {
  success: boolean;
  rows: Record<string, unknown>[];
  cursor: string | null;
  errors: string[];
};

/**
 * Install a `tailordb` global whose select returns the given pages in order.
 * @param pages - Rows each successive select resolves to
 * @returns Queries recorded so far, in execution order
 */
function stubTailordbReads(pages: Record<string, unknown>[][]): RecordedQuery[] {
  const queries: RecordedQuery[] = [];
  let call = 0;
  vi.stubGlobal("tailordb", {
    Client: class {
      async connect() {}
      async end() {}
      async queryObject(sql: string, parameters: readonly unknown[]) {
        queries.push({ sql, parameters });
        const rows = pages[call++] ?? [];
        return { rows, command: "SELECT", rowCount: rows.length };
      }
    },
  });
  return queries;
}

describe("seed dump script behavior", () => {
  const loadDumpMain = async (namespace: string) => {
    const { bundledCode } = await bundleSeedDumpScript(namespace);
    const modulePath = path.join(
      process.env.TAILOR_BUILD_OUTPUT_DIR as string,
      `dump-main-${namespace}.mjs`,
    );
    fs.writeFileSync(modulePath, bundledCode);
    return (await import(/* @vite-ignore */ modulePath)) as {
      main: (input: DumpInput) => Promise<DumpResult>;
    };
  };

  aroundEach(async (runTest) => {
    const testDir = path.join(
      TEST_BUNDLER_BASE,
      `dump-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    fs.mkdirSync(testDir, { recursive: true });
    process.env.TAILOR_BUILD_OUTPUT_DIR = testDir;
    await runTest();
  });

  aroundAll(async (runSuite) => {
    await runSuite();
    delete process.env.TAILOR_BUILD_OUTPUT_DIR;
  });

  test("bundles a script exporting main for the requested namespace", async () => {
    const result = await bundleSeedDumpScript("custom-namespace");

    expect(result.namespace).toBe("custom-namespace");
    expect(result.bundledCode).toContain('"custom-namespace"');
    expect(result.bundledCode).toContain("selectAll");
    expect(result.bundledCode).toContain("orderBy");
  });

  test("reads a page ordered by id and reports no cursor when the page is short", async () => {
    const queries = stubTailordbReads([[{ id: "u1", name: "Alice" }]]);
    const { main } = await loadDumpMain("tailordb");
    using logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await main({ table: "User", limit: 2 });

    expect(queries).toHaveLength(1);
    expect(queries[0]?.sql).toMatch(/^select \*/);
    expect(queries[0]?.sql).toContain('order by "id" asc');
    expect(queries[0]?.sql).not.toContain("where");
    expect(result).toEqual({
      success: true,
      rows: [{ id: "u1", name: "Alice" }],
      cursor: null,
      errors: [],
    });
    expect(logSpy).toHaveBeenCalledWith("[tailordb] User: 1 rows read");
  });

  test("returns the last id as the cursor when the page is full", async () => {
    stubTailordbReads([
      [
        { id: "u1", name: "Alice" },
        { id: "u2", name: "Bob" },
      ],
    ]);
    const { main } = await loadDumpMain("tailordb");
    using _logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await main({ table: "User", limit: 2 });

    expect(result.cursor).toBe("u2");
  });

  test("pages after the given id", async () => {
    const queries = stubTailordbReads([[{ id: "u3", name: "Cara" }]]);
    const { main } = await loadDumpMain("tailordb");
    using _logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await main({ table: "User", limit: 2, after: "u2" });

    expect(queries[0]?.sql).toContain('where "id" > ');
    expect(queries[0]?.parameters).toContain("u2");
  });

  test("refuses to page a full page whose last id is not a string", async () => {
    stubTailordbReads([[{ id: 1 }, { id: 2 }]]);
    const { main } = await loadDumpMain("tailordb");
    using _logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await main({ table: "User", limit: 2 });

    expect(result.success).toBe(false);
    expect(result.errors).toEqual(["cannot page rows whose id is not a string"]);
  });

  test("reports a query failure instead of throwing", async () => {
    vi.stubGlobal("tailordb", {
      Client: class {
        async connect() {}
        async end() {}
        queryObject() {
          return Promise.reject(new Error("relation does not exist"));
        }
      },
    });
    const { main } = await loadDumpMain("tailordb");
    using _errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await main({ table: "Ghost", limit: 2 });

    expect(result.success).toBe(false);
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual(["relation does not exist"]);
  });
});
