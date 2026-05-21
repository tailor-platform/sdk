import {
  isPluginGeneratedType,
  type PluginGeneratedTypeSource,
  type TailorDBType,
  type TypeSourceInfoEntry,
} from "@/types/tailordb";
import ml from "@/utils/multiline";
import type { LinesDbMetadata } from "./types";
import type { ForeignKeyDefinition, IndexDefinition } from "@toiroakr/lines-db";

/**
 * Processes TailorDB types to generate lines-db metadata
 * @param type - Parsed TailorDB type
 * @param source - Source file info
 * @returns Generated lines-db metadata
 */
export function processLinesDb(type: TailorDBType, source: TypeSourceInfoEntry): LinesDbMetadata {
  if (isPluginGeneratedType(source)) {
    // Plugin-generated type
    return processLinesDbForPluginType(type, source);
  }

  // User-defined type
  if (!source.filePath) {
    throw new Error(`Missing source info for type ${type.name}`);
  }
  if (!source.exportName) {
    throw new Error(`Missing export name for type ${type.name}`);
  }

  const { optionalFields, omitFields, indexes, foreignKeys } = extractFieldMetadata(type);

  return {
    typeName: type.name,
    exportName: source.exportName,
    importPath: source.filePath,
    optionalFields,
    omitFields,
    foreignKeys,
    indexes,
  };
}

/**
 * Process lines-db metadata for plugin-generated types
 * @param type - Parsed TailorDB type
 * @param source - Plugin-generated type source info
 * @returns Generated lines-db metadata with plugin source
 */
function processLinesDbForPluginType(
  type: TailorDBType,
  source: PluginGeneratedTypeSource,
): LinesDbMetadata {
  const { optionalFields, omitFields, indexes, foreignKeys } = extractFieldMetadata(type);

  return {
    typeName: type.name,
    exportName: source.exportName,
    importPath: "",
    optionalFields,
    omitFields,
    foreignKeys,
    indexes,
    pluginSource: source,
  };
}

/**
 * Extract field metadata from TailorDB type
 * @param type - Parsed TailorDB type
 * @returns Field metadata including optional fields, omit fields, indexes, and foreign keys
 */
function extractFieldMetadata(type: TailorDBType): {
  optionalFields: string[];
  omitFields: string[];
  indexes: IndexDefinition[];
  foreignKeys: ForeignKeyDefinition[];
} {
  const optionalFields = ["id"]; // id is always optional
  const omitFields: string[] = [];
  const indexes: IndexDefinition[] = [];
  const foreignKeys: ForeignKeyDefinition[] = [];

  // Find fields with hooks.create or serial
  for (const [fieldName, field] of Object.entries(type.fields)) {
    if (field.config.hooks?.create) {
      optionalFields.push(fieldName);
    }
    // Serial fields are auto-generated, so they should be optional in seed data
    if (field.config.serial) {
      omitFields.push(fieldName);
    }
    if (field.config.unique) {
      indexes.push({
        name: `${type.name.toLowerCase()}_${fieldName}_unique_idx`,
        columns: [fieldName],
        unique: true,
      });
    }
  }

  // Extract indexes
  if (type.indexes) {
    for (const [indexName, indexDef] of Object.entries(type.indexes)) {
      indexes.push({
        name: indexName,
        columns: indexDef.fields,
        unique: indexDef.unique,
      });
    }
  }

  // Extract foreign keys from relations
  for (const [fieldName, field] of Object.entries(type.fields)) {
    if (field.relation) {
      foreignKeys.push({
        column: fieldName,
        references: {
          table: field.relation.targetType,
          column: field.relation.key,
        },
      });
    }
  }

  return { optionalFields, omitFields, indexes, foreignKeys };
}

/**
 * Build the shared `defineSchema(createStandardSchema(...))` block.
 *
 * Every generated lines-db schema file ends with the same hook + schema export;
 * extracting it keeps the per-source-kind branches focused on the differing
 * import/binding lines.
 *
 * The returned string is plain (not dedented) so callers can splice it into
 * outer `ml`-tagged templates at the placeholder position and have `ml`
 * re-indent it consistently with the surrounding lines.
 * @param exportName - The exported TailorDB type binding referenced by the schema
 * @param schemaOptionsCode - Pre-rendered options object (foreign keys, indexes) or empty string
 * @returns Code snippet to splice into the generated schema file
 */
function buildSchemaExportCode(exportName: string, schemaOptionsCode: string): string {
  return [
    `const hook = createTailorDBHook(${exportName});`,
    ``,
    `export const schema = defineSchema(`,
    `  createStandardSchema(schemaType, hook, ${exportName}.metadata?.validate),${schemaOptionsCode}`,
    `);`,
  ].join("\n");
}

/**
 * Generate schema options code for lines-db
 * @param foreignKeys - Foreign key definitions
 * @param indexes - Index definitions
 * @returns Schema options code string
 */
function generateSchemaOptions(
  foreignKeys: ForeignKeyDefinition[],
  indexes: IndexDefinition[],
): string {
  const schemaOptions: string[] = [];

  if (foreignKeys.length > 0) {
    schemaOptions.push(`foreignKeys: [`);
    foreignKeys.forEach((fk) => {
      schemaOptions.push(`  ${JSON.stringify(fk)},`);
    });
    schemaOptions.push(`],`);
  }

  if (indexes.length > 0) {
    schemaOptions.push(`indexes: [`);
    indexes.forEach((index) => {
      schemaOptions.push(`  ${JSON.stringify(index)},`);
    });
    schemaOptions.push("],");
  }

  return schemaOptions.length > 0
    ? ["\n  {", ...schemaOptions.map((option) => `    ${option}`), "  }"].join("\n")
    : "";
}

/**
 * Generates the schema file content for lines-db (for user-defined types with import)
 * @param metadata - lines-db metadata
 * @param importPath - Import path for the TailorDB type
 * @returns Schema file contents
 */
export function generateLinesDbSchemaFile(metadata: LinesDbMetadata, importPath: string): string {
  const { exportName, optionalFields, omitFields, foreignKeys, indexes } = metadata;

  const schemaTypeCode = ml /* ts */ `
    const schemaType = t.object({
      ...${exportName}.pickFields(${JSON.stringify(optionalFields)}, { optional: true }),
      ...${exportName}.omitFields(${JSON.stringify([...optionalFields, ...omitFields])}),
    });
    `;

  const schemaOptionsCode = generateSchemaOptions(foreignKeys, indexes);

  return ml /* ts */ `
    import { t } from "@tailor-platform/sdk";
    import { defineSchema } from "@tailor-platform/sdk/seed";
    import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
    import { ${exportName} } from "${importPath}";

    ${schemaTypeCode}

    ${buildSchemaExportCode(exportName, schemaOptionsCode)}

    `;
}

/**
 * Parameters for generating plugin-type schema file
 */
export interface PluginSchemaParams {
  /** Relative path from schema output to tailor.config.ts */
  configImportPath: string;
  /** Relative import path to the original type file (for type-attached plugins) */
  originalImportPath?: string;
}

/**
 * Generates the schema file content using getGeneratedType API
 * (for plugin-generated types)
 * @param metadata - lines-db metadata (must have pluginSource)
 * @param params - Plugin import paths
 * @returns Schema file contents
 */
export function generateLinesDbSchemaFileWithPluginAPI(
  metadata: LinesDbMetadata,
  params: PluginSchemaParams,
): string {
  const { typeName, exportName, optionalFields, omitFields, foreignKeys, indexes, pluginSource } =
    metadata;

  if (!pluginSource) {
    throw new Error(`pluginSource is required for plugin-generated type "${typeName}"`);
  }

  const { configImportPath, originalImportPath } = params;

  const schemaTypeCode = ml /* ts */ `
    const schemaType = t.object({
      ...${exportName}.pickFields(${JSON.stringify(optionalFields)}, { optional: true }),
      ...${exportName}.omitFields(${JSON.stringify([...optionalFields, ...omitFields])}),
    });
    `;

  const schemaOptionsCode = generateSchemaOptions(foreignKeys, indexes);

  // Type-attached plugin (e.g., changeset): import original type and use getGeneratedType(configPath, pluginId, type, kind)
  if (pluginSource.originalExportName && originalImportPath && pluginSource.generatedTypeKind) {
    return ml /* ts */ `
    import { join } from "node:path";
    import { t } from "@tailor-platform/sdk";
    import { getGeneratedType } from "@tailor-platform/sdk/plugin";
    import { defineSchema } from "@tailor-platform/sdk/seed";
    import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
    import { ${pluginSource.originalExportName} } from "${originalImportPath}";

    const configPath = join(import.meta.dirname, "${configImportPath}");
    const ${exportName} = await getGeneratedType(configPath, "${pluginSource.pluginId}", ${pluginSource.originalExportName}, "${pluginSource.generatedTypeKind}");

    ${schemaTypeCode}

    ${buildSchemaExportCode(exportName, schemaOptionsCode)}

    `;
  }

  // Namespace plugin (e.g., audit-log): use getGeneratedType(configPath, pluginId, null, kind)
  // For namespace plugins, generatedTypeKind is required
  if (!pluginSource.generatedTypeKind) {
    throw new Error(
      `Namespace plugin "${pluginSource.pluginId}" must provide generatedTypeKind for type "${typeName}"`,
    );
  }

  return ml /* ts */ `
    import { join } from "node:path";
    import { t } from "@tailor-platform/sdk";
    import { getGeneratedType } from "@tailor-platform/sdk/plugin";
    import { defineSchema } from "@tailor-platform/sdk/seed";
    import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";

    const configPath = join(import.meta.dirname, "${configImportPath}");
    const ${exportName} = await getGeneratedType(configPath, "${pluginSource.pluginId}", null, "${pluginSource.generatedTypeKind}");

    ${schemaTypeCode}

    ${buildSchemaExportCode(exportName, schemaOptionsCode)}

    `;
}
