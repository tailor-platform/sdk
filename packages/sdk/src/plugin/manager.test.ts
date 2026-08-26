import { describe, expect, test } from "vitest";
import { db } from "#/configure/services/tailordb/index";
import { PluginManager } from "#/plugin/manager";
import type { Plugin } from "#/plugin/types";

const orderType = () => db.table("Order", { name: db.string() });

describe("PluginManager", () => {
  test("collects namespace plugin-generated tables", async () => {
    const plugin: Plugin = {
      id: "namespace-plugin",
      description: "namespace generator",
      importPath: "@example/namespace",
      onNamespaceLoaded: () => ({
        tables: {
          auditLog: db.table("AuditLog", {
            message: db.string(),
          }),
        },
      }),
    };

    const manager = new PluginManager([plugin]);
    await manager.processNamespacePlugins("main");

    const generatedTables = manager.getPluginGeneratedTables();
    expect(generatedTables).toHaveLength(1);
    expect(generatedTables[0]).toMatchObject({
      pluginId: "namespace-plugin",
      sourceTableName: "(namespace)",
      kind: "auditLog",
      table: {
        name: "AuditLog",
      },
    });
  });

  test("dedupes namespace plugin-generated outputs across namespaces", async () => {
    const plugin: Plugin = {
      id: "namespace-plugin",
      description: "namespace generator",
      importPath: "@example/namespace",
      onNamespaceLoaded: () => ({
        tables: {
          auditLog: db.table("AuditLog", {
            message: db.string(),
          }),
        },
        executors: [
          {
            name: "audit-log",
            trigger: { kind: "incomingWebhook" },
            operation: { kind: "function", body: "return {}" },
          },
        ],
      }),
    };

    const manager = new PluginManager([plugin]);
    await manager.processNamespacePlugins("main");
    await manager.processNamespacePlugins("analytics");

    expect(manager.getPluginGeneratedTables()).toHaveLength(1);
    expect(manager.getPluginGeneratedExecutors()).toHaveLength(1);
  });

  test("preserves pluralForm and plugin attachments when extending tables", () => {
    const manager = new PluginManager();
    const original = db
      .table(["Person", "People"], {
        name: db.string(),
      })
      // PluginConfigs is open; use cast to attach plugin config in tests.
      .plugin({ "test-plugin": { enabled: true } });

    const extended = manager.extendTable({
      originalTable: original,
      extendFields: {
        age: db.int(),
      },
      pluginId: "extender",
    });

    expect(extended.metadata.settings?.pluralForm).toBe("People");
    expect(extended.plugins).toEqual([{ pluginId: "test-plugin", config: { enabled: true } }]);
  });

  test("requires per-table config when tableConfigRequired is true", async () => {
    const plugin: Plugin = {
      id: "requires-config",
      description: "requires per-table config",
      importPath: "@example/require-config",
      tableConfigRequired: true,
      onTableLoaded: () => ({}),
    };

    const manager = new PluginManager([plugin]);
    const result = await manager.processAttachment({
      table: orderType(),
      tableConfig: undefined,
      namespace: "main",
      pluginId: "requires-config",
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected plugin attachment to fail");
    }
    expect(result.error).toContain("requires tableConfig");
  });

  test("processes table attachment without configSchema (arbitrary config)", async () => {
    const plugin: Plugin = {
      id: "schema-less-plugin",
      description: "plugin without configSchema",
      importPath: "@example/schema-less",
      onTableLoaded: (_context: Parameters<NonNullable<Plugin["onTableLoaded"]>>[0]) => ({
        tables: {
          derived: db.table("Derived", {
            sourceId: db.uuid(),
            customValue: db.string(),
          }),
        },
      }),
    };

    const manager = new PluginManager([plugin]);
    const result = await manager.processAttachment({
      table: orderType(),
      tableConfig: { anyArbitraryValue: 42, nested: { deep: true } },
      namespace: "main",
      pluginId: "schema-less-plugin",
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected plugin attachment to succeed");
    }
    expect(result.output.tables).toBeDefined();
    expect(result.output.tables?.["derived"]!.name).toBe("Derived");
  });
});
