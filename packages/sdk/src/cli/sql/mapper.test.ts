import * as fs from "node:fs";
import * as path from "pathe";
import { describe, expect, test } from "vitest";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { makeTempDir } from "#/cli/shared/test-helpers/temp-dir";
import { createSqlMapperHandlers } from "./mapper";

const ORDER_TABLE = `
import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";
export const order = db
  .table("Order", { status: db.enum(["PAID", "OPEN"]), orderDate: db.date() })
  .permission(unsafeAllowAllTypePermission)
  .gqlPermission(unsafeAllowAllGqlPermission);
`;

// Inside the package, so the project's `@tailor-platform/sdk` imports resolve to its build.
function project(): Disposable & { dir: string; config: string; table: string; tsconfig: string } {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(import.meta.dirname, ".sdk-sql-mapper-")));
  const config = path.join(dir, "tailor.config.ts");
  const table = path.join(dir, "tailordb", "order.ts");
  fs.mkdirSync(path.dirname(table));
  fs.writeFileSync(
    config,
    `import { defineConfig, definePlugins } from "@tailor-platform/sdk";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";
export default defineConfig({ name: "app", db: { main: { files: ["./tailordb/*.ts"] } } });
export const plugins = definePlugins(kyselyTypePlugin({ distPath: "./generated/db.ts", temporal: true }));
`,
  );
  fs.writeFileSync(table, ORDER_TABLE);
  return {
    dir,
    config,
    table,
    tsconfig: path.join(dir, "tsconfig.json"),
    [Symbol.dispose]() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

type Handlers = ReturnType<typeof createSqlMapperHandlers>;

async function open(handlers: Handlers, configFileName: string, options?: unknown) {
  return (await handlers.openProject!({
    configFileName,
    projectHandle: "p1",
    compilerOptions: {},
    ...(options === undefined ? {} : { options }),
  })) as { configIdentity: string; watchedFiles: string[]; optionDiagnostics: unknown[] };
}

async function transform(handlers: Handlers, content: string) {
  return (await handlers.transform!({ fileName: "/q.sql", content, projectHandle: "p1" })) as {
    text: string;
    extension: string;
    diagnostics: { messageText: string; start: number; length: number; code: number }[];
    mappings: number[][];
  };
}

describe("content mapper", () => {
  test("initializes with UTF-16 positions when offered", async () => {
    expect(
      await createSqlMapperHandlers().initialize!({
        positionEncodings: ["utf-8", "utf-16"],
        protocolVersion: 1,
      }),
    ).toEqual({ protocolVersion: 1, positionEncoding: "utf-16", diagnosticSource: "tailordb-sql" });
  });

  test("types a .sql file from the project's TailorDB definitions", async () => {
    using p = project();
    const handlers = createSqlMapperHandlers();
    await handlers.initialize!({ positionEncodings: ["utf-16"] });

    const opened = await open(handlers, p.tsconfig);
    const content = 'SELECT "status", "orderDate" FROM "Order" WHERE "status" = :status';
    const result = await transform(handlers, content);

    expect(opened).toEqual({
      configIdentity: expect.any(String),
      watchedFiles: expect.arrayContaining([p.config, p.table]),
      optionDiagnostics: [],
    });
    expect(result).toEqual({
      extension: ".ts",
      text: expect.stringContaining(
        'SqlQuery<{ status: "PAID" | "OPEN" }, { status: "PAID" | "OPEN"; orderDate: Temporal.PlainDate }, "many">',
      ),
      diagnostics: [],
      mappings: [[0, result.text.length, 0, content.length, 1, 24]],
    });
  });

  test("reports problems at their place in the file, in the negotiated encoding", async () => {
    using p = project();
    const handlers = createSqlMapperHandlers();
    await handlers.initialize!({ positionEncodings: ["utf-8"] });
    await open(handlers, p.tsconfig);

    const result = await transform(handlers, '-- 注文\nSELECT "nope" FROM "Order"');

    expect(result.diagnostics).toEqual([
      {
        messageText: 'Column "nope" does not exist in "Order"',
        start: Buffer.byteLength("-- 注文\nSELECT "),
        length: '"nope"'.length,
        code: 1,
      },
    ]);
    expect(result.text).toContain("run(client: SqlClient");
  });

  test("changes its identity and types when a definition changes", async () => {
    using p = project();
    const handlers = createSqlMapperHandlers();
    await handlers.initialize!({ positionEncodings: ["utf-16"] });
    const before = await open(handlers, p.tsconfig);

    fs.writeFileSync(p.table, ORDER_TABLE.replace('["PAID", "OPEN"]', '["PAID", "OPEN", "VOID"]'));
    const after = await open(handlers, p.tsconfig);

    expect(after.configIdentity).not.toBe(before.configIdentity);
    expect((await transform(handlers, 'SELECT "status" FROM "Order"')).text).toContain(
      '"PAID" | "OPEN" | "VOID"',
    );
  });

  test("reports a definition that fails to load on every file and keeps watching its files", async () => {
    using p = project();
    const handlers = createSqlMapperHandlers();
    await handlers.initialize!({ positionEncodings: ["utf-16"] });
    await open(handlers, p.tsconfig);

    fs.writeFileSync(p.table, "export const order = ;\n");
    using _logger = silenceLogger("error");
    const opened = await open(handlers, p.tsconfig);
    const result = await transform(handlers, 'SELECT "status" FROM "Order"');

    expect(opened.watchedFiles).toEqual(expect.arrayContaining([p.config, p.table]));
    expect(result.diagnostics).toEqual([
      { messageText: expect.stringContaining("order.ts"), start: 0, length: 0, code: 2 },
    ]);
  });

  test("reports a project without tailor.config.ts and watches for one", async () => {
    const dir = makeTempDir("sdk-sql-mapper-no-config-");
    try {
      const handlers = createSqlMapperHandlers();
      await handlers.initialize!({ positionEncodings: ["utf-16"] });
      const opened = await open(handlers, path.join(dir, "tsconfig.json"));
      const result = await transform(handlers, 'SELECT "status" FROM "Order"');

      expect(opened.watchedFiles).toEqual([path.join(dir, "tailor.config.ts")]);
      expect(result.diagnostics).toEqual([
        {
          messageText: `No tailor.config.ts found in ${dir} or its parent directories`,
          start: 0,
          length: 0,
          code: 2,
        },
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reports options it does not take", async () => {
    using p = project();
    const handlers = createSqlMapperHandlers();
    await handlers.initialize!({ positionEncodings: ["utf-16"] });

    expect((await open(handlers, p.tsconfig, { temporal: true })).optionDiagnostics).toEqual([
      {
        path: ["temporal"],
        messageText:
          "@tailor-platform/sdk's content mapper takes no options; it reads tailor.config.ts",
        code: 3,
      },
    ]);
  });
});
