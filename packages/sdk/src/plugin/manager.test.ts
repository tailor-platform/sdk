import { describe, expect, test } from "vitest";
import { db } from "@/configure/services/tailordb";
import { PluginManager } from "@/plugin/manager";
import type { Plugin } from "@/plugin/types";

describe("PluginManager", () => {
  test("collects namespace plugin-generated types", async () => {
    const plugin: Plugin = {
      id: "namespace-plugin",
      description: "namespace generator",
      importPath: "@example/namespace",
      onNamespaceLoaded: () => ({
        types: {
          auditLog: db.type("AuditLog", {
            message: db.string(),
          }),
        },
      }),
    };

    const manager = new PluginManager([plugin]);
    await manager.processNamespacePlugins("main");

    const generatedTypes = manager.getPluginGeneratedTypes();
    expect(generatedTypes).toHaveLength(1);
    expect(generatedTypes[0]).toMatchObject({
      pluginId: "namespace-plugin",
      sourceTypeName: "(namespace)",
      kind: "auditLog",
      type: {
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
        types: {
          auditLog: db.type("AuditLog", {
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

    expect(manager.getPluginGeneratedTypes()).toHaveLength(1);
    expect(manager.getPluginGeneratedExecutors()).toHaveLength(1);
  });

  test("preserves pluralForm and plugin attachments when extending types", () => {
    const manager = new PluginManager();
    const original = db
      .type(["Person", "People"], {
        name: db.string(),
      })
      // PluginConfigs is open; use cast to attach plugin config in tests.
      .plugin({ "test-plugin": { enabled: true } } as Record<string, unknown>);

    const extended = manager.extendType({
      originalType: original,
      extendFields: {
        age: db.int(),
      },
      pluginId: "extender",
    });

    expect(extended.metadata.settings?.pluralForm).toBe("People");
    expect(extended.plugins).toEqual([{ pluginId: "test-plugin", config: { enabled: true } }]);
  });

  test("requires per-type config when typeConfigRequired is true", async () => {
    const plugin: Plugin = {
      id: "requires-config",
      description: "requires per-type config",
      importPath: "@example/require-config",
      typeConfigRequired: true,
      onTypeLoaded: () => ({}),
    };

    const manager = new PluginManager([plugin]);
    const result = await manager.processAttachment({
      type: db.type("Order", {
        name: db.string(),
      }),
      typeConfig: undefined,
      namespace: "main",
      pluginId: "requires-config",
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected plugin attachment to fail");
    }
    expect(result.error).toContain("requires typeConfig");
  });

  test("processes type attachment without configSchema (arbitrary config)", async () => {
    const plugin: Plugin = {
      id: "schema-less-plugin",
      description: "plugin without configSchema",
      importPath: "@example/schema-less",
      onTypeLoaded: (_context: Parameters<NonNullable<Plugin["onTypeLoaded"]>>[0]) => ({
        types: {
          derived: db.type("Derived", {
            sourceId: db.uuid(),
            customValue: db.string(),
          }),
        },
      }),
    };

    const manager = new PluginManager([plugin]);
    const result = await manager.processAttachment({
      type: db.type("Order", { name: db.string() }),
      typeConfig: { anyArbitraryValue: 42, nested: { deep: true } },
      namespace: "main",
      pluginId: "schema-less-plugin",
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected plugin attachment to succeed");
    }
    expect(result.output.types).toBeDefined();
    expect(result.output.types?.["derived"]!.name).toBe("Derived");
  });
});
