import { generatePgliteSchemaModule, type DDLTableConfig } from "#/utils/tailordb-ddl";
import type { TailorDBType } from "#/parser/service/tailordb/types";

/** Tables of one namespace, as the schema module groups them. */
export interface PGliteSchemaNamespace {
  namespace: string;
  tables: Record<string, TailorDBType>;
}

/**
 * Reduce parsed tables to what the DDL generator reads.
 * @param tables - Parsed TailorDB tables keyed by name
 * @returns DDL table configs in the same order
 */
export function toDDLTables(tables: Record<string, TailorDBType>): DDLTableConfig[] {
  return Object.values(tables).map((type) => ({
    name: type.name,
    fields: Object.fromEntries(
      Object.entries(type.fields).map(([fieldName, field]) => [fieldName, field.config]),
    ),
    indexes: type.indexes,
  }));
}

/**
 * Render the module that exports each namespace's `CREATE TABLE` script for
 * `pglite.exec()`.
 * @param namespaces - Namespaces with their parsed tables
 * @returns TypeScript source of the schema module
 */
export function generatePGliteSchemaModule(namespaces: readonly PGliteSchemaNamespace[]): string {
  return generatePgliteSchemaModule(
    namespaces.map(({ namespace, tables }) => ({ namespace, tables: toDDLTables(tables) })),
    { generatedBy: "the kysely-type plugin" },
  );
}
