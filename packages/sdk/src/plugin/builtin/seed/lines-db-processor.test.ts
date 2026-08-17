import { describe, expect, test } from "vitest";
import { generateLinesDbSchemaFileWithPluginAPI, processLinesDb } from "./lines-db-processor";
import type { TailorDBType, TypeSourceInfoEntry } from "#/parser/service/tailordb/types";
import type { LinesDbMetadata } from "./types";

describe("generateLinesDbSchemaFileWithPluginAPI", () => {
  test("generates a getGeneratedTable call for a namespace plugin table", () => {
    const metadata: LinesDbMetadata = {
      typeName: "AuditLog",
      exportName: "AuditLog",
      importPath: "",
      optionalFields: ["id"],
      omitFields: [],
      foreignKeys: [],
      indexes: [],
      pluginSource: {
        exportName: "AuditLog",
        pluginId: "audit-plugin",
        pluginImportPath: "@example/audit-plugin",
        originalFilePath: "",
        originalExportName: "",
        generatedTableKind: "auditLog",
      },
    };

    const source = generateLinesDbSchemaFileWithPluginAPI(metadata, {
      configImportPath: "../../../tailor.config.ts",
    });

    expect(source).toContain('import { getGeneratedTable } from "@tailor-platform/sdk/plugin";');
    expect(source).toContain('getGeneratedTable(configPath, "audit-plugin", null, "auditLog")');
    expect(source).not.toContain(["getGenerated", "Type"].join(""));
  });
});

describe("processLinesDb", () => {
  test("reports a missing export name for a table", () => {
    const type = {
      name: "User",
      fields: {},
    } as TailorDBType;
    const source = {
      filePath: "/test/user.ts",
      exportName: "",
    } satisfies TypeSourceInfoEntry;

    expect(() => processLinesDb(type, source)).toThrow("Missing export name for table User");
  });
});
