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
}

/**
 * Combined metadata for seed generation
 */
export interface SeedTypeMetadata {
  typeInfo: SeedTypeInfo;
  linesDb: LinesDbMetadata;
}
