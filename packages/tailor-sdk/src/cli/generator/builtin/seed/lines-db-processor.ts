import ml from "multiline-ts";
import type { LinesDbMetadata } from "./types";
import type { ParsedTailorDBType } from "@/parser/service/tailordb/types";
import type { ForeignKeyDefinition, IndexDefinition } from "@toiroakr/lines-db";

/**
 * Processes TailorDB types to generate lines-db metadata
 */
export function processLinesDb(
  type: ParsedTailorDBType,
  source: { filePath: string; exportName: string },
): LinesDbMetadata {
  if (!source.filePath || !source.exportName) {
    throw new Error(`Missing source info for type ${type.name}`);
  }

  const optionalFields = ["id"]; // id is always optional
  const indexes: IndexDefinition[] = [];
  const foreignKeys: ForeignKeyDefinition[] = [];

  // Find fields with hooks.create
  for (const [fieldName, field] of Object.entries(type.fields)) {
    if (field.config.hooks?.create) {
      optionalFields.push(fieldName);
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

  return {
    typeName: type.name,
    exportName: source.exportName,
    importPath: source.filePath,
    optionalFields,
    foreignKeys,
    indexes,
  };
}

/**
 * Generates the schema file content for lines-db
 */
export function generateLinesDbSchemaFile(
  metadata: LinesDbMetadata,
  importPath: string,
): string {
  const { exportName, optionalFields, foreignKeys, indexes } = metadata;

  const pickFieldsArray = JSON.stringify(optionalFields);
  const schemaTypeCode = ml /* ts */ `
    const schemaType = t.object({
      ...${exportName}.pickFields(${pickFieldsArray}, { optional: true }),
      ...${exportName}.omitFields(${pickFieldsArray}),
    });
    `;

  // Generate SchemaOptions
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

  return ml /* ts */ `
    import { t } from "@tailor-platform/tailor-sdk";
    import { createTailorDBHook, createStandardSchema } from "@tailor-platform/tailor-sdk/test";
    import { defineSchema } from "@toiroakr/lines-db";
    import { ${exportName} } from "${importPath}";

    ${schemaTypeCode}

    const hook = createTailorDBHook(${exportName});

    export const schema = defineSchema(
      createStandardSchema(schemaType, hook),${
        schemaOptions.length > 0
          ? [
              "\n  {",
              ...schemaOptions.map((option) => `    ${option}`),
              "  }",
            ].join("\n")
          : ""
      }
    );
    `;
}
