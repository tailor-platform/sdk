import { describe, expect, test } from "vitest";
import { generateSchemaDDL, toDDLTables, type DDLTableConfig } from "./index";
import type { TailorDBType } from "#/parser/service/tailordb/types";

describe("plugin entry DDL helpers", () => {
  test("generateSchemaDDL renders a CREATE TABLE script for the given tables", () => {
    const tables: DDLTableConfig[] = [
      { name: "Account", fields: { email: { type: "string", required: true } } },
    ];
    expect(generateSchemaDDL(tables)).toContain('CREATE TABLE IF NOT EXISTS "Account"');
  });

  test("toDDLTables carries each parsed field's config and the table's indexes", () => {
    const parsed = {
      Account: {
        name: "Account",
        fields: { role: { config: { type: "enum", allowedValues: [{ value: "ADMIN" }] } } },
        indexes: { byRole: { fields: ["role"], unique: true } },
      },
    } as unknown as Record<string, TailorDBType>;
    expect(toDDLTables(parsed)).toEqual([
      {
        name: "Account",
        fields: { role: { type: "enum", allowedValues: [{ value: "ADMIN" }] } },
        indexes: { byRole: { fields: ["role"], unique: true } },
      },
    ]);
  });
});
