import { describe, expect, it } from "vitest";
import { t } from "@/configure";
import { db } from "@/configure/services/tailordb";
import { PluginManager } from "@/plugin/manager";
import type { PluginBase, PluginConfigs } from "@/parser/plugin-config/types";

describe("PluginManager", () => {
  it("collects namespace plugin-generated types", async () => {
    const plugin: PluginBase = {
      id: "namespace-plugin",
      description: "namespace generator",
      importPath: "@example/namespace",
      processNamespace: () => ({
        types: {
          auditLog: db.type("AuditLog", {
            message: db.string(),
          }),
        },
      }),
    };

    const manager = new PluginManager([plugin]);
    await manager.processNamespacePlugins("main", [], []);

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

  it("dedupes namespace plugin-generated outputs across namespaces", async () => {
    const plugin: PluginBase = {
      id: "namespace-plugin",
      description: "namespace generator",
      importPath: "@example/namespace",
      processNamespace: () => ({
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
    await manager.processNamespacePlugins("main", [], []);
    await manager.processNamespacePlugins("analytics", [], []);

    expect(manager.getPluginGeneratedTypes()).toHaveLength(1);
    expect(manager.getPluginGeneratedExecutors()).toHaveLength(1);
  });

  it("preserves pluralForm and plugin attachments when extending types", () => {
    const manager = new PluginManager();
    const original = db
      .type(["Person", "People"], {
        name: db.string(),
      })
      // PluginConfigs is open; use a cast to attach plugin config in tests.
      .plugin({ "test-plugin": { enabled: true } } as PluginConfigs);

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

  it("requires per-type config when typeConfigRequired is true", async () => {
    const plugin: PluginBase = {
      id: "requires-config",
      description: "requires per-type config",
      importPath: "@example/require-config",
      configSchema: t.object({}),
      typeConfigRequired: true,
      process: () => ({}),
    };

    const manager = new PluginManager([plugin]);
    const result = await manager.processAttachment({
      type: db.type("Order", {
        name: db.string(),
      }),
      config: undefined,
      namespace: "main",
      pluginId: "requires-config",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("requires config");
    }
  });
});
