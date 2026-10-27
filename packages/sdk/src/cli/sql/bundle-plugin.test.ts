import * as fs from "node:fs";
import * as path from "pathe";
import { describe, expect, test, vi } from "vitest";
import { createBundleCache } from "#/cli/cache/bundle-cache";
import { createCacheStore } from "#/cli/cache/store";
import { buildFunctionBundle } from "#/cli/services/function-bundle";
import { logger } from "#/cli/shared/logger";
import { db } from "#/configure/services/tailordb/schema";
import { parseTypes } from "#/parser/service/tailordb/index";
import { toSchemaOutput } from "#/utils/test/internal";
import { createSqlContext } from "./definitions";
import type { SqlDefinitions } from "#/utils/sql/analyze";

function definitions(statusValues: [string, ...string[]]): SqlDefinitions {
  const order = db.table("Order", { status: db.enum(statusValues), amount: db.int() });
  return {
    namespaces: new Map([
      ["main", Object.values(parseTypes({ Order: toSchemaOutput(order) }, "main", {}))],
    ]),
    temporal: false,
  };
}

// Inside the package, so the bundled `@tailor-platform/sdk/runtime/sql` import resolves to its build.
function projectDir(prefix: string): Disposable & { readonly dir: string } {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(import.meta.dirname, prefix)));
  return {
    dir,
    [Symbol.dispose]() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function writeProject(dir: string, sql: string): string {
  fs.writeFileSync(path.join(dir, "query.sql"), sql);
  const sourceFile = path.join(dir, "function.ts");
  fs.writeFileSync(
    sourceFile,
    'import query from "./query.sql";\nexport default async () => query.sql + query.namespace;\n',
  );
  return sourceFile;
}

function bundle(sourceFile: string, options: Partial<Parameters<typeof buildFunctionBundle>[0]>) {
  return buildFunctionBundle({
    kind: "resolver",
    name: "fn",
    sourceFile,
    tsconfig: undefined,
    runtimeGlobals: false,
    entry: (absoluteSourcePath) => `export { default as main } from "${absoluteSourcePath}";\n`,
    ...options,
  });
}

describe("bundling .sql imports", () => {
  test("bundles a .sql import as a query bound by placeholder name", async () => {
    using tmp = projectDir(".sdk-sql-bundle-");
    const sourceFile = writeProject(
      tmp.dir,
      '-- orders by status\nSELECT "amount" FROM "Order" WHERE "status" = :status',
    );

    const code = await bundle(sourceFile, {
      sql: createSqlContext(definitions(["PAID"]), path.join(tmp.dir, "definitions.json")),
    });

    expect(code).toContain('SELECT "amount" FROM "Order" WHERE "status" = $1');
    expect(code).toMatch(/paramNames:\[`status`\]/);
    expect(code).toMatch(/namespace:`main`/);
    expect(code).not.toContain("orders by status");
  });

  test("fails with every problem of the file, located in it", async () => {
    using tmp = projectDir(".sdk-sql-bundle-invalid-");
    const sourceFile = writeProject(
      tmp.dir,
      'SELECT "nope"\nFROM "Order" WHERE "status" = \'NONE\'',
    );

    await expect(
      bundle(sourceFile, {
        sql: createSqlContext(definitions(["PAID"]), path.join(tmp.dir, "definitions.json")),
      }),
    ).rejects.toMatchObject({
      code: "SQL_INVALID",
      message: expect.stringMatching(
        /query\.sql:1:8: Column "nope" does not exist in "Order"\n.*query\.sql:2:31: 'NONE' is not a value of "status": PAID$/,
      ),
      context: {
        file: path.join(tmp.dir, "query.sql"),
        diagnostics: [
          { line: 1, column: 8, message: 'Column "nope" does not exist in "Order"' },
          { line: 2, column: 31, message: "'NONE' is not a value of \"status\": PAID" },
        ],
      },
    });
  });

  test("fails a .sql import where no TailorDB definitions are available", async () => {
    using tmp = projectDir(".sdk-sql-bundle-unsupported-");
    const sourceFile = writeProject(tmp.dir, 'SELECT "amount" FROM "Order"');

    await expect(bundle(sourceFile, {})).rejects.toMatchObject({
      code: "SQL_UNSUPPORTED",
    });
  });

  test("rebuilds a cached bundle when the .sql file or the TailorDB definitions change", async () => {
    using tmp = projectDir(".sdk-sql-bundle-cache-");
    using _debug = vi.spyOn(logger, "debug").mockImplementation(() => {});
    const sourceFile = writeProject(
      tmp.dir,
      'SELECT "amount" FROM "Order" WHERE "status" = \'PAID\'',
    );
    const cache = createBundleCache(createCacheStore({ cacheDir: path.join(tmp.dir, ".cache") }));
    const fingerprint = path.join(tmp.dir, "definitions.json");

    await bundle(sourceFile, { cache, sql: createSqlContext(definitions(["PAID"]), fingerprint) });
    await expect(
      bundle(sourceFile, { cache, sql: createSqlContext(definitions(["OPEN"]), fingerprint) }),
    ).rejects.toMatchObject({ code: "SQL_INVALID" });

    fs.writeFileSync(path.join(tmp.dir, "query.sql"), 'SELECT "nope" FROM "Order"');
    await expect(
      bundle(sourceFile, { cache, sql: createSqlContext(definitions(["PAID"]), fingerprint) }),
    ).rejects.toMatchObject({ code: "SQL_INVALID" });
  });
});
