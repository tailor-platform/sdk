import type { ForeignKeyDefinition, IndexDefinition } from "@toiroakr/lines-db";

/**
 * Type definitions for seed generation.
 */

/**
 * Metadata for GraphQL Ingest generation
 */
export interface GqlIngestMetadata {
  name: string;
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
  gqlIngest: GqlIngestMetadata;
  linesDb: LinesDbMetadata;
}
