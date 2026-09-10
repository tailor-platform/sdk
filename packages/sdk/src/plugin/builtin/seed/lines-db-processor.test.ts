import { describe, expect, test } from "vitest";
import {
  generateLinesDbSchemaFile,
  generateLinesDbSchemaFileWithPluginAPI,
  processLinesDb,
} from "./lines-db-processor";
import type { TailorDBType, TypeSourceInfoEntry } from "#/parser/service/tailordb/types";
import type { LinesDbMetadata } from "./types";

describe("generateLinesDbSchemaFileWithPluginAPI", () => {
  test("generates a getGeneratedTable call for a namespace plugin table", () => {
    const metadata: LinesDbMetadata = {
      tableName: "AuditLog",
      exportName: "AuditLog",
      importPath: "",
      fields: ["id", "action"],
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

  test("passes every declared field name to the seed schema", () => {
    const metadata: LinesDbMetadata = {
      tableName: "AuditLog",
      exportName: "AuditLog",
      importPath: "",
      fields: ["id", "action"],
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

    expect(source).toContain(
      'createStandardSchema(schemaType, hook, AuditLog, { fields: ["id","action"] })',
    );
  });

  test("passes every declared field name for a table-attached plugin table", () => {
    const metadata: LinesDbMetadata = {
      tableName: "UserChangeset",
      exportName: "UserChangeset",
      importPath: "",
      fields: ["id", "recordId", "diff"],
      optionalFields: ["id"],
      omitFields: [],
      foreignKeys: [],
      indexes: [],
      pluginSource: {
        exportName: "UserChangeset",
        pluginId: "changeset-plugin",
        pluginImportPath: "@example/changeset-plugin",
        originalFilePath: "/test/user.ts",
        originalExportName: "user",
        generatedTableKind: "changeset",
      },
    };

    const source = generateLinesDbSchemaFileWithPluginAPI(metadata, {
      configImportPath: "../../../tailor.config.ts",
      originalImportPath: "../../tailordb/user",
    });

    expect(source).toContain(
      'getGeneratedTable(configPath, "changeset-plugin", user, "changeset")',
    );
    expect(source).toContain(
      'createStandardSchema(schemaType, hook, UserChangeset, { fields: ["id","recordId","diff"] })',
    );
  });
});

describe("generateLinesDbSchemaFile", () => {
  test("passes every declared field name to the seed schema", () => {
    const source = generateLinesDbSchemaFile(
      {
        tableName: "User",
        exportName: "User",
        importPath: "../../tailordb/user",
        fields: ["id", "name", "deletedAt"],
        optionalFields: ["id"],
        omitFields: [],
        foreignKeys: [],
        indexes: [],
      },
      "../../tailordb/user",
    );

    expect(source).toContain(
      'createStandardSchema(schemaType, hook, User, { fields: ["id","name","deletedAt"] })',
    );
  });
});

describe("processLinesDb", () => {
  test("lists every field of the table, serial fields included", () => {
    const type = {
      name: "Invoice",
      fields: {
        id: { config: {} },
        number: { config: { serial: { start: 1 } } },
        total: { config: {} },
      },
    } as unknown as TailorDBType;
    const source = { filePath: "/test/invoice.ts", exportName: "Invoice" };

    const metadata = processLinesDb(type, source);

    expect(metadata.fields).toEqual(["id", "number", "total"]);
    expect(metadata.omitFields).toEqual(["number"]);
  });

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
