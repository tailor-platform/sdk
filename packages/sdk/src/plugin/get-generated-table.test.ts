import * as fs from "node:fs";
import * as os from "node:os";
import { pathToFileURL } from "node:url";
import * as path from "pathe";
import { aroundEach, describe, expect, expectTypeOf, test } from "vitest";
import { db } from "#/configure/services/tailordb/index";
import { _clearCacheForTesting } from "./get-generated-table";
import { getExtendedTable, getGeneratedTable } from "./index";
import type { TailorAnyDBType } from "#/configure/services/tailordb/types";

declare global {
  // oxlint-disable-next-line no-var
  var __testProcessNamespaceCalls: string[];
  // oxlint-disable-next-line no-var
  var __testProcessTableCalls: string[];
  // oxlint-disable-next-line no-var
  var __testExtendCalls: string[];
}

describe("getExtendedTable", () => {
  let configPath: string;
  let tablePath: string;

  aroundEach(async (runTest) => {
    _clearCacheForTesting();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailor-test-"));
    configPath = path.join(tempDir, "tailor.config.mjs");
    tablePath = path.join(tempDir, "order.mjs");
    globalThis.__testExtendCalls = [];
    await runTest();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const writeTable = (attachments: string) => {
    fs.writeFileSync(
      tablePath,
      `import { db } from "@tailor-platform/sdk";
export const order = db
  .table("Order", { name: db.string() })
  .hooks({ create: () => ({ name: "hooked" }) });
order.plugin(${attachments});
`,
    );
  };

  const writeConfig = (plugins: string) => {
    fs.writeFileSync(
      configPath,
      `import { db } from "@tailor-platform/sdk";
export const plugins = [${plugins}];
export default {
  db: {
    main: { files: [${JSON.stringify(tablePath)}] },
  },
};
`,
    );
  };

  const extendingPlugin = (id: string, field: string, fieldCode: string) => `{
  id: ${JSON.stringify(id)},
  description: "test",
  importPath: "@test/${id}",
  onTableLoaded({ table, tableConfig }) {
    globalThis.__testExtendCalls.push(
      [${JSON.stringify(id)}, Object.keys(table.fields).join(","), JSON.stringify(tableConfig)].join(":"),
    );
    return { extends: { fields: { ${field}: ${fieldCode} } } };
  },
}`;

  const loadTable = async () =>
    ((await import(pathToFileURL(tablePath).href)) as { order: TailorAnyDBType }).order;

  test("returns the source table itself when no plugin is attached", async () => {
    writeTable("{}");
    const order = await loadTable();

    const table = await getExtendedTable(path.join(path.dirname(configPath), "missing.mjs"), order);

    expect(table).toBe(order);
  });

  test("keeps the source table's type, builder methods included", async () => {
    const order = db.table("Order", { name: db.string() });

    const table = await getExtendedTable(configPath, order);

    expect(table).toBe(order);
    expectTypeOf(table).toEqualTypeOf<typeof order>();
    expectTypeOf(table.pickFields(["name"])).toHaveProperty("name");
    expectTypeOf(table.omitFields(["name"])).not.toHaveProperty("name");
  });

  test("applies the fields each attached plugin adds, in attachment order", async () => {
    writeTable('{ "first": { flag: true }, "second": {} }');
    writeConfig(
      [
        extendingPlugin("first", "deletedAt", "db.datetime({ optional: true })"),
        extendingPlugin("second", "rank", "db.int()"),
      ].join(",\n"),
    );
    const order = await loadTable();

    const table = await getExtendedTable(configPath, order);

    expect(Object.keys(table.fields)).toEqual(["id", "name", "deletedAt", "rank"]);
    expect(Object.keys(order.fields)).toEqual(["id", "name"]);
    expect(table.metadata.typeHook).toBe(order.metadata.typeHook);
    expect(table.plugins).toEqual(order.plugins);
    expect(globalThis.__testExtendCalls).toEqual([
      'first:id,name:{"flag":true}',
      "second:id,name,deletedAt:{}",
    ]);
  });

  test("returns the source table when no attached plugin adds fields", async () => {
    writeTable('{ "archiver": {} }');
    writeConfig(`{
  id: "archiver",
  description: "test",
  importPath: "@test/archiver",
  onTableLoaded() {
    return { tables: { archive: db.table("OrderArchive", { name: db.string() }) } };
  },
}`);
    const order = await loadTable();

    expect(await getExtendedTable(configPath, order)).toBe(order);
  });

  test("runs the plugins once per table, even for concurrent callers", async () => {
    writeTable('{ "first": {} }');
    writeConfig(extendingPlugin("first", "rank", "db.int()"));
    const order = await loadTable();

    const [a, b] = await Promise.all([
      getExtendedTable(configPath, order),
      getExtendedTable(configPath, order),
    ]);
    const c = await getExtendedTable(configPath, order);

    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(globalThis.__testExtendCalls).toHaveLength(1);
  });

  test("leaves an array that mixes plugins with other values alone, as the CLI does", async () => {
    writeTable('{ "first": {} }');
    writeConfig(`${extendingPlugin("first", "rank", "db.int()")}, "not a plugin"`);
    const order = await loadTable();

    await expect(getExtendedTable(configPath, order)).rejects.toThrow('Plugin "first" not found');
  });

  test("reports a plugin the config does not register", async () => {
    writeTable('{ "unregistered": {} }');
    writeConfig("");
    const order = await loadTable();

    await expect(getExtendedTable(configPath, order)).rejects.toThrow(
      'Plugin "unregistered" not found',
    );
  });

  test("returns the source table when the config is unavailable", async () => {
    writeTable('{ "first": {} }');
    const order = await loadTable();

    const table = await getExtendedTable(
      path.join(path.dirname(configPath), "missing.config.mjs"),
      order,
    );

    expect(table).toBe(order);
  });
});

describe("getGeneratedTable", () => {
  let configPath: string;

  aroundEach(async (runTest) => {
    _clearCacheForTesting();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailor-test-"));
    configPath = path.join(tempDir, "tailor.config.mjs");
    await runTest();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("namespace plugin", () => {
    test("onNamespaceLoaded is called only once per namespace during resolution", async () => {
      fs.writeFileSync(
        configPath,
        `export const plugins = [{
  id: "ns-plugin",
  description: "test",
  importPath: "@test/ns-plugin",
  onNamespaceLoaded({ pluginConfig, namespace }) {
    globalThis.__testProcessNamespaceCalls.push(namespace);
    return {
      tables: {
        auditLog: { name: "AuditLog", fields: { message: {} } },
      },
    };
  },
}];
export default {
  db: {
    main: { files: [] },
  },
};
`,
      );

      globalThis.__testProcessNamespaceCalls = [];

      await getGeneratedTable(configPath, "ns-plugin", null, "auditLog");

      expect(globalThis.__testProcessNamespaceCalls).toEqual(["main"]);
    });
  });

  describe("table-attached plugin", () => {
    test("passes the table context and caches the generated table", async () => {
      const tablePath = path.join(path.dirname(configPath), "order.mjs");
      fs.writeFileSync(
        tablePath,
        `export const order = {
  name: "Order",
  fields: {},
  plugins: [{ pluginId: "table-plugin", config: { retentionDays: 30 } }],
};
`,
      );
      fs.writeFileSync(
        configPath,
        `export const plugins = [{
  id: "table-plugin",
  description: "test",
  importPath: "@test/table-plugin",
  onTableLoaded({ table, tableConfig, namespace }) {
    globalThis.__testProcessTableCalls.push(
      [table.name, tableConfig.retentionDays, namespace].join(":"),
    );
    return {
      tables: {
        archive: { name: "OrderArchive", fields: {}, plugins: [] },
      },
    };
  },
}];
export default {
  db: {
    main: { files: [${JSON.stringify(tablePath)}] },
  },
};
`,
      );
      const { order } = (await import(pathToFileURL(tablePath).href)) as {
        order: TailorAnyDBType;
      };
      globalThis.__testProcessTableCalls = [];

      const first = await getGeneratedTable(configPath, "table-plugin", order, "archive");
      const second = await getGeneratedTable(configPath, "table-plugin", order, "archive");

      expect(first.name).toBe("OrderArchive");
      expect(second).toBe(first);
      expect(globalThis.__testProcessTableCalls).toEqual(["Order:30:main"]);
    });
  });

  test("returns a placeholder when the config is unavailable", async () => {
    const table = await getGeneratedTable(
      path.join(path.dirname(configPath), "missing.config.mjs"),
      "missing-plugin",
      null,
      "auditLog",
    );

    expect(table).toMatchObject({ name: "__placeholder_auditLog__", fields: {} });
  });
});
