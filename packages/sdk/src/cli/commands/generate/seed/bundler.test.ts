import * as fs from "node:fs";
import * as path from "pathe";
import { afterEach, aroundAll, aroundEach, describe, expect, test, vi } from "vitest";
import { bundleSeedScript } from "./bundler";

const TEST_BUNDLER_BASE = path.join(__dirname, "__test_bundler__");

type SeedInput = {
  data: Record<string, Record<string, unknown>[]>;
  order: string[];
  selfRefTypes: string[];
  upsert?: boolean;
};

type SeedResult = {
  success: boolean;
  processed: Record<string, number>;
  errors: string[];
};

type RecordedQuery = { sql: string; parameters: readonly unknown[] };

/**
 * Install a `tailordb` global that records the SQL the bundled seed script issues.
 * @returns Queries recorded so far, in execution order
 */
function stubTailordb(): RecordedQuery[] {
  const queries: RecordedQuery[] = [];
  vi.stubGlobal("tailordb", {
    Client: class {
      async connect() {}
      async end() {}
      async queryObject(sql: string, parameters: readonly unknown[]) {
        queries.push({ sql, parameters });
        return { rows: [], command: "INSERT", rowCount: 1 };
      }
    },
  });
  return queries;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("seed-bundler", () => {
  aroundEach(async (runTest) => {
    // Set TAILOR_SDK_OUTPUT_DIR to test directory so bundled output goes into test directory
    const testDir = path.join(
      TEST_BUNDLER_BASE,
      `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    fs.mkdirSync(testDir, { recursive: true });
    process.env.TAILOR_SDK_OUTPUT_DIR = testDir;
    await runTest();
  });

  aroundAll(async (runSuite) => {
    await runSuite();
    delete process.env.TAILOR_SDK_OUTPUT_DIR;
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

    test("generates upsert logic gated on the runtime upsert input", async () => {
      const result = await bundleSeedScript("tailordb", ["User"]);

      expect(result.bundledCode).toContain("onConflict");
      expect(result.bundledCode).toContain("doUpdateSet");
      expect(result.bundledCode).toContain("upsert");
    });

    test("targets only the id column on conflict", async () => {
      const result = await bundleSeedScript("tailordb", ["User"]);

      expect(result.bundledCode).toContain('column("id")');
    });
  });
});

describe("seed script upsert behavior", () => {
  const loadMain = async (namespace: string, typeNames: string[]) => {
    const { bundledCode } = await bundleSeedScript(namespace, typeNames);
    const modulePath = path.join(
      process.env.TAILOR_SDK_OUTPUT_DIR as string,
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
    process.env.TAILOR_SDK_OUTPUT_DIR = testDir;
    await runTest();
  });

  aroundAll(async (runSuite) => {
    await runSuite();
    delete process.env.TAILOR_SDK_OUTPUT_DIR;
    try {
      fs.rmSync(TEST_BUNDLER_BASE, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("emits ON CONFLICT DO UPDATE when upsert is enabled", async () => {
    const queries = stubTailordb();
    const { main } = await loadMain("tailordb", ["User"]);

    await main({
      data: { User: [{ id: "u1", name: "Alice" }] },
      order: ["User"],
      selfRefTypes: [],
      upsert: true,
    });

    const sql = queries.at(-1)?.sql ?? "";
    expect(sql).toContain('on conflict ("id")');
    expect(sql).toContain("do update set");
    expect(sql).toContain('"name" = "excluded"."name"');
  });

  test("does not emit ON CONFLICT when upsert is disabled", async () => {
    const queries = stubTailordb();
    const { main } = await loadMain("tailordb", ["User"]);

    await main({
      data: { User: [{ id: "u1", name: "Alice" }] },
      order: ["User"],
      selfRefTypes: [],
      upsert: false,
    });

    expect(queries.at(-1)?.sql ?? "").not.toContain("on conflict");
  });

  test("excludes the conflict target from the update set", async () => {
    const queries = stubTailordb();
    const { main } = await loadMain("tailordb", ["User"]);

    await main({
      data: { User: [{ id: "u1", name: "Alice" }] },
      order: ["User"],
      selfRefTypes: [],
      upsert: true,
    });

    const updateClause = (queries.at(-1)?.sql ?? "").split("do update set")[1] ?? "";
    expect(updateClause).not.toContain('"id"');
  });

  test("never updates a column absent from a row, so batching cannot clobber it", async () => {
    const queries = stubTailordb();
    const { main } = await loadMain("tailordb", ["User"]);

    await main({
      data: {
        User: [
          { id: "u1", name: "Alice", email: "alice@example.com" },
          { id: "u2", name: "Bob" },
        ],
      },
      order: ["User"],
      selfRefTypes: [],
      upsert: true,
    });

    // A row without `email` must not take part in a statement that assigns
    // `email`, otherwise the existing value is overwritten with the column default.
    for (const { sql, parameters } of queries) {
      if (!sql.includes('"email" = "excluded"."email"')) continue;
      expect(parameters).not.toContain("u2");
    }
    expect(queries.some((query) => query.parameters.includes("u2"))).toBe(true);
  });

  test("groups rows so no statement inserts a default for a missing key", async () => {
    const queries = stubTailordb();
    const { main } = await loadMain("tailordb", ["User"]);

    await main({
      data: {
        User: [
          { id: "u1", name: "Alice", email: "alice@example.com" },
          { id: "u2", name: "Bob" },
        ],
      },
      order: ["User"],
      selfRefTypes: [],
      upsert: true,
    });

    for (const { sql } of queries) {
      expect(sql).not.toContain("default");
    }
  });

  test("upserts self-referencing types one-by-one", async () => {
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

    expect(result.processed.Category).toBe(2);
    expect(queries).toHaveLength(2);
    for (const query of queries) {
      expect(query.sql).toContain('on conflict ("id")');
    }
  });
});
