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

  test("builds the seed schema from the generated table itself", () => {
    const metadata: LinesDbMetadata = {
      tableName: "AuditLog",
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

    expect(source).toContain("createStandardSchema(schemaType, hook, AuditLog)");
  });

  test("builds the seed schema from a table-attached plugin's generated table", () => {
    const metadata: LinesDbMetadata = {
      tableName: "UserChangeset",
      exportName: "UserChangeset",
      importPath: "",
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
    expect(source).toContain("createStandardSchema(schemaType, hook, UserChangeset)");
  });
});

describe("generateLinesDbSchemaFile", () => {
  const metadata: LinesDbMetadata = {
    tableName: "User",
    exportName: "user",
    importPath: "../../tailordb/user",
    optionalFields: ["id"],
    omitFields: [],
    foreignKeys: [],
    indexes: [],
  };

  test("imports the table from its source file when no plugin is attached", () => {
    const source = generateLinesDbSchemaFile(metadata, { typeImportPath: "../../tailordb/user" });

    expect(source).toContain('import { user } from "../../tailordb/user";');
    expect(source).toContain("createStandardSchema(schemaType, hook, user)");
    expect(source).not.toContain("getExtendedTable");
  });

  test("loads the table through getExtendedTable when plugins are attached", () => {
    const source = generateLinesDbSchemaFile(metadata, {
      typeImportPath: "../../tailordb/user",
      configImportPath: "../../tailor.config.ts",
    });

    expect(source).toContain('import { getExtendedTable } from "@tailor-platform/sdk/plugin";');
    expect(source).toContain('import { user as sourceTable } from "../../tailordb/user";');
    expect(source).toContain(
      'const configPath = join(import.meta.dirname, "../../tailor.config.ts");',
    );
    expect(source).toContain("const table = await getExtendedTable(configPath, sourceTable);");
    expect(source).toContain('...table.pickFields(["id"], { optional: true }),');
    expect(source).toContain("export const hook = createTailorDBHook(table);");
    expect(source).toContain("createStandardSchema(schemaType, hook, table)");
  });
});

describe("processLinesDb", () => {
  test("omits serial fields from the seed schema", () => {
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

    expect(metadata.omitFields).toEqual(["number"]);
    expect(metadata.optionalFields).toEqual(["id"]);
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
