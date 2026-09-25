import { describe, expect, test } from "vitest";
import { isPluginGeneratedTable } from "./type-source";
import type { TypeSourceInfoEntry } from "./types";

describe("isPluginGeneratedTable", () => {
  test("identifies plugin-generated table source metadata", () => {
    const source: TypeSourceInfoEntry = {
      exportName: "AuditLog",
      pluginId: "audit-plugin",
      pluginImportPath: "@example/audit-plugin",
      originalFilePath: "tailordb/user.ts",
      originalExportName: "User",
      generatedTableKind: "auditLog",
    };

    expect(isPluginGeneratedTable(source)).toBe(true);
  });

  test("rejects user-defined table source metadata", () => {
    const source: TypeSourceInfoEntry = {
      filePath: "tailordb/user.ts",
      exportName: "User",
    };

    expect(isPluginGeneratedTable(source)).toBe(false);
  });
});
