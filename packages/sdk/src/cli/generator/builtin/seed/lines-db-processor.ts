import ml from "multiline-ts";
import type { LinesDbMetadata, PluginSourceInfo } from "./types";
import type { TypeSourceInfoEntry } from "@/cli/generator/types";
import type { TailorDBType } from "@/parser/service/tailordb/types";
import type { ForeignKeyDefinition, IndexDefinition } from "@toiroakr/lines-db";

/**
 * Processes TailorDB types to generate lines-db metadata
 * @param type - Parsed TailorDB type
 * @param source - Source file info
 * @returns Generated lines-db metadata
 */
export function processLinesDb(type: TailorDBType, source: TypeSourceInfoEntry): LinesDbMetadata {
  // Plugin-generated types don't have a source file path
  const isPluginGenerated = !!source.pluginId;
  if (!isPluginGenerated && !source.filePath) {
    throw new Error(`Missing source info for type ${type.name}`);
  }
  if (!source.exportName) {
    throw new Error(`Missing export name for type ${type.name}`);
  }

  const optionalFields = ["id"]; // id is always optional
  const omitFields = [];
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

  // Build plugin source info if this is a plugin-generated type
  // For standalone plugins (no originalFilePath), we still need to mark it as plugin-generated
  const pluginSource: PluginSourceInfo | undefined = source.pluginId
    ? {
        pluginId: source.pluginId,
        pluginImportPath: source.pluginImportPath,
        originalFilePath: source.originalFilePath || "",
        originalExportName: source.originalExportName || "",
        generatedTypeKind: source.generatedTypeKind,
      }
    : undefined;

  return {
    typeName: type.name,
    exportName: source.exportName,
    importPath: source.filePath,
    optionalFields,
    omitFields,
    foreignKeys,
    indexes,
    pluginSource,
  };
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
    import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
    import { defineSchema } from "@toiroakr/lines-db";
    import { ${exportName} } from "${importPath}";

    ${schemaTypeCode}

    const hook = createTailorDBHook(${exportName});

    export const schema = defineSchema(
      createStandardSchema(schemaType, hook),${schemaOptionsCode}
    );

    `;
}

/**
 * Plugin import information for getGeneratedType API
 */
export interface PluginTypeImport {
  /** Plugin ID (e.g., "@tailor-platform/changeset") */
  pluginId: string;
  /** Plugin import path (e.g., "@tailor-platform/sdk/changeset-plugin") */
  pluginImportPath: string;
  /** Original type's export name (for type-attached plugins) */
  originalExportName?: string;
  /** Original type's import path (for type-attached plugins) */
  originalImportPath?: string;
  /** Generated type kind (e.g., "request", "step") */
  generatedTypeKind?: string;
}

/**
 * Generates the schema file content using getGeneratedType API
 * (for plugin-generated types)
 * @param metadata - lines-db metadata
 * @param pluginImport - Plugin import information
 * @returns Schema file contents
 */
export function generateLinesDbSchemaFileWithPluginAPI(
  metadata: LinesDbMetadata,
  pluginImport: PluginTypeImport,
): string {
  const { typeName, exportName, optionalFields, omitFields, foreignKeys, indexes } = metadata;
  const { pluginImportPath } = pluginImport;

  const schemaTypeCode = ml /* ts */ `
    const schemaType = t.object({
      ...${exportName}.pickFields(${JSON.stringify(optionalFields)}, { optional: true }),
      ...${exportName}.omitFields(${JSON.stringify([...optionalFields, ...omitFields])}),
    });
    `;

  const schemaOptionsCode = generateSchemaOptions(foreignKeys, indexes);

  // Type-attached plugin (e.g., changeset): import original type and use getGeneratedType(type, kind)
  if (
    pluginImport.originalExportName &&
    pluginImport.originalImportPath &&
    pluginImport.generatedTypeKind
  ) {
    return ml /* ts */ `
    import { t } from "@tailor-platform/sdk";
    import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
    import { defineSchema } from "@toiroakr/lines-db";
    import { getGeneratedType } from "${pluginImportPath}";
    import { ${pluginImport.originalExportName} } from "${pluginImport.originalImportPath}";

    const ${exportName} = getGeneratedType(${pluginImport.originalExportName}, "${pluginImport.generatedTypeKind}");

    ${schemaTypeCode}

    const hook = createTailorDBHook(${exportName});

    export const schema = defineSchema(
      createStandardSchema(schemaType, hook),${schemaOptionsCode}
    );

    `;
  }

  // Standalone plugin (e.g., audit-log): use getGeneratedType(null, kind)
  // For standalone plugins, generatedTypeKind is required
  if (!pluginImport.generatedTypeKind) {
    throw new Error(
      `Standalone plugin "${pluginImport.pluginId}" must provide generatedTypeKind for type "${typeName}"`,
    );
  }

  return ml /* ts */ `
    import { t } from "@tailor-platform/sdk";
    import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
    import { defineSchema } from "@toiroakr/lines-db";
    import { getGeneratedType } from "${pluginImportPath}";

    const ${exportName} = getGeneratedType(null, "${pluginImport.generatedTypeKind}");

    ${schemaTypeCode}

    const hook = createTailorDBHook(${exportName});

    export const schema = defineSchema(
      createStandardSchema(schemaType, hook),${schemaOptionsCode}
    );

    `;
}
