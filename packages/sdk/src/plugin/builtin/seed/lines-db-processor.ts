import { isPluginGeneratedTable } from "#/parser/service/tailordb/type-source";
import ml from "#/utils/multiline";
import type {
  ParsedField,
  PluginGeneratedTableSource,
  TailorDBType,
  TypeSourceInfoEntry,
} from "#/parser/service/tailordb/types";
import type { LinesDbMetadata } from "./types";
import type { ForeignKeyDefinition, IndexDefinition } from "@toiroakr/lines-db";

/**
 * Processes TailorDB tables to generate lines-db metadata
 * @param type - Parsed TailorDB table
 * @param source - Source file info
 * @returns Generated lines-db metadata
 */
export function processLinesDb(type: TailorDBType, source: TypeSourceInfoEntry): LinesDbMetadata {
  if (isPluginGeneratedTable(source)) {
    // Plugin-generated table
    return processLinesDbForPluginTable(type, source);
  }

  // User-defined table
  if (!source.filePath) {
    throw new Error(`Missing source info for table ${type.name}`);
  }
  if (!source.exportName) {
    throw new Error(`Missing export name for table ${type.name}`);
  }

  const { optionalFields, omitFields, indexes, foreignKeys } = extractFieldMetadata(type);

  return {
    tableName: type.name,
    exportName: source.exportName,
    importPath: source.filePath,
    optionalFields,
    omitFields,
    foreignKeys,
    indexes,
  };
}

/**
 * Process lines-db metadata for plugin-generated tables
 * @param type - Parsed TailorDB table
 * @param source - Plugin-generated table source info
 * @returns Generated lines-db metadata with plugin source
 */
function processLinesDbForPluginTable(
  type: TailorDBType,
  source: PluginGeneratedTableSource,
): LinesDbMetadata {
  const { optionalFields, omitFields, indexes, foreignKeys } = extractFieldMetadata(type);

  return {
    tableName: type.name,
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
 * Whether the platform produces a value for the field on create when a row omits it,
 * either from a create hook or from a schema default. Such fields stay optional in seed
 * data even when the table marks them required.
 * @param field - Parsed TailorDB field
 * @returns True when a seed row does not have to supply the field
 */
function isGeneratedOnCreate(field: ParsedField): boolean {
  return field.config.hooks?.create !== undefined || field.config.default !== undefined;
}

/**
 * Extract field metadata from TailorDB table
 * @param type - Parsed TailorDB table
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

  // Find fields generated on create, or serial
  for (const [fieldName, field] of Object.entries(type.fields)) {
    if (isGeneratedOnCreate(field)) {
      optionalFields.push(fieldName);
    }
    // Serial fields are auto-generated, so they are excluded from the seed schema entirely
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
 * Generates the schema file content for lines-db (for user-defined tables with import)
 * @param metadata - lines-db metadata
 * @param importPath - Import path for the TailorDB table
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

    export const hook = createTailorDBHook(${exportName});

    export const schema = defineSchema(
      createStandardSchema(schemaType, hook, ${exportName}),${schemaOptionsCode}
    );

    `;
}

/**
 * Parameters for generating a plugin-generated table's schema file
 */
export interface PluginSchemaParams {
  /** Relative path from schema output to tailor.config.ts */
  configImportPath: string;
  /** Relative import path to the original table file (for table-attached plugins) */
  originalImportPath?: string;
}

/**
 * Generates the schema file content using getGeneratedTable API
 * (for plugin-generated tables)
 * @param metadata - lines-db metadata (must have pluginSource)
 * @param params - Plugin import paths
 * @returns Schema file contents
 */
export function generateLinesDbSchemaFileWithPluginAPI(
  metadata: LinesDbMetadata,
  params: PluginSchemaParams,
): string {
  const { tableName, exportName, optionalFields, omitFields, foreignKeys, indexes, pluginSource } =
    metadata;

  if (!pluginSource) {
    throw new Error(`pluginSource is required for plugin-generated table "${tableName}"`);
  }

  const { configImportPath, originalImportPath } = params;

  const schemaTypeCode = ml /* ts */ `
    const schemaType = t.object({
      ...${exportName}.pickFields(${JSON.stringify(optionalFields)}, { optional: true }),
      ...${exportName}.omitFields(${JSON.stringify([...optionalFields, ...omitFields])}),
    });
    `;

  const schemaOptionsCode = generateSchemaOptions(foreignKeys, indexes);

  // Table-attached plugin (e.g., changeset): import the original table and use getGeneratedTable(configPath, pluginId, table, kind)
  if (pluginSource.originalExportName && originalImportPath && pluginSource.generatedTableKind) {
    return ml /* ts */ `
    import { join } from "node:path";
    import { t } from "@tailor-platform/sdk";
    import { getGeneratedTable } from "@tailor-platform/sdk/plugin";
    import { defineSchema } from "@tailor-platform/sdk/seed";
    import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
    import { ${pluginSource.originalExportName} } from "${originalImportPath}";

    const configPath = join(import.meta.dirname, "${configImportPath}");
    const ${exportName} = await getGeneratedTable(configPath, "${pluginSource.pluginId}", ${pluginSource.originalExportName}, "${pluginSource.generatedTableKind}");

    ${schemaTypeCode}

    export const hook = createTailorDBHook(${exportName});

    export const schema = defineSchema(
      createStandardSchema(schemaType, hook, ${exportName}),${schemaOptionsCode}
    );

    `;
  }

  // Namespace plugin (e.g., audit-log): use getGeneratedTable(configPath, pluginId, null, kind)
  // For namespace plugins, generatedTableKind is required
  if (!pluginSource.generatedTableKind) {
    throw new Error(
      `Namespace plugin "${pluginSource.pluginId}" must provide generatedTableKind for table "${tableName}"`,
    );
  }

  return ml /* ts */ `
    import { join } from "node:path";
    import { t } from "@tailor-platform/sdk";
    import { getGeneratedTable } from "@tailor-platform/sdk/plugin";
    import { defineSchema } from "@tailor-platform/sdk/seed";
    import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";

    const configPath = join(import.meta.dirname, "${configImportPath}");
    const ${exportName} = await getGeneratedTable(configPath, "${pluginSource.pluginId}", null, "${pluginSource.generatedTableKind}");

    ${schemaTypeCode}

    export const hook = createTailorDBHook(${exportName});

    export const schema = defineSchema(
      createStandardSchema(schemaType, hook, ${exportName}),${schemaOptionsCode}
    );

    `;
}
