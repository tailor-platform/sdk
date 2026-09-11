import type { PluginGeneratedTableSource } from "#/parser/service/tailordb/types";
import type { ForeignKeyDefinition, IndexDefinition } from "@toiroakr/lines-db";

/**
 * Type definitions for seed generation.
 */

/**
 * Basic type information for seed generation
 */
export interface SeedTypeInfo {
  name: string;
  namespace: string;
  dependencies: string[];
  selfRefFields: string[];
  /** The field each self-referencing field is keyed to (defaults to "id"). */
  selfRefKeys: Record<string, string>;
  dataFile: string;
}

/**
 * Metadata for lines-db schema generation
 */
export interface LinesDbMetadata {
  tableName: string;
  exportName: string;
  importPath: string;
  /** Every field the table declares, including fields plugins add to it */
  fields: string[];
  optionalFields: string[];
  omitFields: string[];
  foreignKeys: ForeignKeyDefinition[];
  indexes: IndexDefinition[];
  /** Plugin source info if this is a plugin-generated type */
  pluginSource?: PluginGeneratedTableSource;
}
