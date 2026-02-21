/**
 * Built-in generator for GraphQL schema type declarations.
 * Generates declare module augmentation for GeneratedGqlSchema
 * to enable type-safe GraphQL operations in executors/resolvers.
 */

import * as inflection from "inflection";
import * as path from "pathe";
import {
  isPluginGeneratedType,
  type TailorDBGenerator,
  type TailorDBInput,
  type AggregateArgs,
  type GeneratorResult,
  type TypeSourceInfoEntry,
} from "@/cli/generator/types";
import { generateGqlSchemaDts } from "./generate-dts";
import type { GqlSchemaEntryMetadata, GqlSchemaTypeMetadata } from "./types";
import type { TailorDBType } from "@/parser/service/tailordb/types";

export const GqlSchemaGeneratorID = "@tailor-platform/graphql-schema";

type GqlSchemaGeneratorOptions = {
  distPath: string;
};

/**
 * Compute the relative import path from the output directory to a source file.
 * @param baseDir - Base directory of the project (where tailor.config.ts is)
 * @param outputDir - Directory where the .d.ts will be written
 * @param filePath - File path relative to baseDir
 * @returns Import specifier (e.g., "./tailordb/user")
 */
function computeImportPath(baseDir: string, outputDir: string, filePath: string): string {
  const absolutePath = path.resolve(baseDir, filePath);
  let relativePath = path
    .relative(outputDir, absolutePath)
    .replace(/\\/g, "/")
    .replace(/\.ts$/, "");
  if (!relativePath.startsWith(".")) relativePath = `./${relativePath}`;
  return relativePath;
}

/**
 * Check if a GraphQL operation is enabled for a type.
 * @param type - The parsed TailorDB type
 * @param operation - The operation to check
 * @returns True if the operation is enabled (default is enabled)
 */
function isOperationEnabled(
  type: TailorDBType,
  operation: "create" | "update" | "delete" | "read",
): boolean {
  if (!type.settings.gqlOperations) return true;
  return type.settings.gqlOperations[operation] !== false;
}

/**
 * Process a single TailorDB type into GraphQL schema metadata.
 * Returns null for plugin-generated types (no filePath).
 * @param args - Processing arguments
 * @param args.type - The parsed TailorDB type
 * @param args.source - Source info for the type (user-defined or plugin-generated)
 * @returns Type metadata with GraphQL operation entries, or null if skipped
 */
export function processType(args: {
  type: TailorDBType;
  source: TypeSourceInfoEntry;
}): GqlSchemaTypeMetadata | null {
  const { type, source } = args;

  // Skip plugin-generated types (no filePath to import from)
  if (isPluginGeneratedType(source)) return null;

  const entries: GqlSchemaEntryMetadata[] = [];
  const getQueryName = inflection.camelize(type.name, true);
  const listQueryName = inflection.camelize(type.pluralForm, true);

  // Placeholder for typeRef — actual import path is resolved in aggregate.
  // Uses `|` as separator since `:` can appear in file paths (e.g., Windows drive letters).
  const typeRefKey = `__typeRef|${source.filePath}|${source.exportName}__`;

  // Read operations (get + list)
  if (isOperationEnabled(type, "read")) {
    entries.push({
      operationName: getQueryName,
      variablesExpr: "{ id: string }",
      resultExpr: `{ ${getQueryName}: InferGqlResult<${typeRefKey}> | null }`,
    });

    entries.push({
      operationName: listQueryName,
      variablesExpr: "Record<string, unknown>",
      resultExpr: `{ ${listQueryName}: { collection: InferGqlResult<${typeRefKey}>[] } }`,
    });
  }

  // Create mutation
  if (isOperationEnabled(type, "create")) {
    const createName = `create${type.name}`;
    entries.push({
      operationName: createName,
      variablesExpr: `{ input: InferCreateInput<${typeRefKey}> }`,
      resultExpr: `{ ${createName}: InferGqlResult<${typeRefKey}> }`,
    });
  }

  // Update mutation
  if (isOperationEnabled(type, "update")) {
    const updateName = `update${type.name}`;
    entries.push({
      operationName: updateName,
      variablesExpr: `{ id: string; input: InferUpdateInput<${typeRefKey}> }`,
      resultExpr: `{ ${updateName}: InferGqlResult<${typeRefKey}> }`,
    });
  }

  // Delete mutation
  if (isOperationEnabled(type, "delete")) {
    const deleteName = `delete${type.name}`;
    entries.push({
      operationName: deleteName,
      variablesExpr: "{ id: string }",
      resultExpr: `{ ${deleteName}: { id: string } }`,
    });
  }

  // BulkUpsert mutation
  if (type.settings.bulkUpsert && isOperationEnabled(type, "create")) {
    const bulkUpsertName = `bulkUpsert${type.pluralForm}`;
    entries.push({
      operationName: bulkUpsertName,
      variablesExpr: `{ input: InferCreateInput<${typeRefKey}>[] }`,
      resultExpr: `{ ${bulkUpsertName}: InferGqlResult<${typeRefKey}>[] }`,
    });
  }

  return { name: type.name, entries };
}

/**
 * Create a GraphQL schema generator for TailorDB types.
 * @param options - Generator options
 * @param options.distPath - Output file path for the .d.ts file
 * @returns TailorDB generator instance
 */
export function createGqlSchemaGenerator(options: GqlSchemaGeneratorOptions) {
  return {
    id: GqlSchemaGeneratorID,
    description: "Generates GraphQL schema type declarations for TailorDB types",
    dependencies: ["tailordb"] as const,

    async processType(args: {
      type: TailorDBType;
      namespace: string;
      source: TypeSourceInfoEntry;
    }): Promise<GqlSchemaTypeMetadata | null> {
      return processType({ type: args.type, source: args.source });
    },

    aggregate(
      args: AggregateArgs<TailorDBInput<Record<string, GqlSchemaTypeMetadata | null>>>,
    ): GeneratorResult {
      const files: GeneratorResult["files"] = [];
      const allTypes: GqlSchemaTypeMetadata[] = [];

      const outputDir = path.resolve(path.dirname(args.configPath), path.dirname(options.distPath));
      const baseDir = path.dirname(args.configPath);

      for (const nsResult of args.input.tailordb) {
        if (!nsResult.types) continue;
        for (const typeMetadata of Object.values(nsResult.types)) {
          if (!typeMetadata) continue;

          // Resolve typeRef placeholders to actual import paths
          const resolved: GqlSchemaTypeMetadata = {
            name: typeMetadata.name,
            entries: typeMetadata.entries.map((entry) => ({
              operationName: entry.operationName,
              variablesExpr: resolveTypeRefs(entry.variablesExpr, baseDir, outputDir),
              resultExpr: resolveTypeRefs(entry.resultExpr, baseDir, outputDir),
            })),
          };
          allTypes.push(resolved);
        }
      }

      if (allTypes.length > 0) {
        const content = generateGqlSchemaDts(allTypes);
        if (content) {
          files.push({ path: options.distPath, content });
        }
      }

      return { files };
    },
  } satisfies TailorDBGenerator<GqlSchemaTypeMetadata | null>;
}

/**
 * Replace typeRef placeholders with actual typeof import expressions.
 * @param expr - Expression string with __typeRef|filePath|exportName__ placeholders
 * @param baseDir - Base directory of the project
 * @param outputDir - Output directory for the .d.ts file
 * @returns Expression with resolved import paths
 */
function resolveTypeRefs(expr: string, baseDir: string, outputDir: string): string {
  return expr.replace(/__typeRef\|([^|]+)\|(.+?)__/g, (_match, filePath, exportName) => {
    const importPath = computeImportPath(baseDir, outputDir, filePath as string);
    return `(typeof import("${importPath}"))["${exportName as string}"]`;
  });
}
