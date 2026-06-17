import type { PluginGeneratedTypeSource } from "#src/parser/service/tailordb/types";
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
  dataFile: string;
}

/**
 * Metadata for lines-db schema generation
 */
export interface LinesDbMetadata {
  typeName: string;
  exportName: string;
  importPath: string;
  optionalFields: string[];
  omitFields: string[];
  foreignKeys: ForeignKeyDefinition[];
  indexes: IndexDefinition[];
  /** Plugin source info if this is a plugin-generated type */
  pluginSource?: PluginGeneratedTypeSource;
}
