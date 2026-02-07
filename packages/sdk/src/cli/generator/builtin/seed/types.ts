import type { ForeignKeyDefinition, IndexDefinition } from "@toiroakr/lines-db";

/**
 * Type definitions for seed generation.
 */

/**
 * Metadata for GraphQL Ingest generation
 */
export interface GqlIngestMetadata {
  name: string;
  namespace: string;
  dependencies: string[];
  mapping: {
    dataFile: string;
    dataFormat: string;
    graphqlFile: string;
    mapping: { input: "$" };
  };
  graphql: string;
}

/**
 * Plugin source information for type generation
 */
export interface PluginSourceInfo {
  pluginId: string;
  /** Plugin import path for code generators (e.g., "@tailor-platform/sdk/changeset-plugin") */
  pluginImportPath?: string;
  originalFilePath: string;
  originalExportName: string;
  /** Generated type kind identifier (e.g., "request", "step") */
  generatedTypeKind?: string;
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
  pluginSource?: PluginSourceInfo;
}

/**
 * Combined metadata for seed generation
 */
export interface SeedTypeMetadata {
  gqlIngest: GqlIngestMetadata;
  linesDb: LinesDbMetadata;
  /** Types that this type has relations to (for dependency resolution) */
  relationTargets?: string[];
}
