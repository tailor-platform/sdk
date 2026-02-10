import { describe, expect, it } from "vitest";
import { db } from "@/configure/services/tailordb";
import { t } from "@/configure/types";
import { PluginManager } from "@/plugin/manager";
import type { PluginBase } from "@/parser/plugin-config/types";

describe("PluginManager", () => {
  it("collects standalone plugin-generated types", async () => {
    const plugin: PluginBase = {
      id: "standalone-plugin",
      description: "standalone generator",
      importPath: "@example/standalone",
      configSchema: t.object({}),
      processStandalone: () => ({
        types: {
          auditLog: db.type("AuditLog", {
            message: db.string(),
          }),
        },
      }),
    };

    const manager = new PluginManager([plugin]);
    await manager.processStandalonePlugins("main");

    const generatedTypes = manager.getPluginGeneratedTypes();
    expect(generatedTypes).toHaveLength(1);
    expect(generatedTypes[0]).toMatchObject({
      pluginId: "standalone-plugin",
      sourceTypeName: "(standalone)",
      kind: "auditLog",
      type: {
        name: "AuditLog",
      },
    });
  });

  it("preserves pluralForm and plugin attachments when extending types", () => {
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
});
