import * as fs from "node:fs";
import * as os from "node:os";
import { pathToFileURL } from "node:url";
import * as path from "pathe";
import { aroundEach, describe, expect, test } from "vitest";
import { _clearCacheForTesting } from "./get-generated-table";
import { getGeneratedTable } from "./index";
import type { TailorAnyDBType } from "#/configure/services/tailordb/types";

declare global {
  // oxlint-disable-next-line no-var
  var __testProcessNamespaceCalls: string[];
  // oxlint-disable-next-line no-var
  var __testProcessTableCalls: string[];
}

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

      // onNamespaceLoaded for "main" should be called exactly once.
      // Bug: currently called twice - once in resolveNamespaceForNamespacePlugin (result discarded),
      // and once again in getGeneratedTableForNamespacePlugin.
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
