import { COLUMN_TYPE_ALIASES, mapFieldTypeToColumnType } from "#/utils/field-column-type";
import multiline from "#/utils/multiline";
import {
  type KyselyFieldConfig,
  type KyselyNamespaceMetadata,
  type KyselyTypeMetadata,
} from "./types";
import type { TailorDBType } from "#/parser/service/tailordb/types";

type UsedUtilityTypes = { Timestamp: boolean; Serial: boolean };

type FieldTypeResult = {
  type: string;
  usedUtilityTypes: UsedUtilityTypes;
};

/**
 * Get the enum type definition.
 * @param fieldConfig - The field configuration
 * @returns The enum type as a string union
 */
function getEnumType(fieldConfig: KyselyFieldConfig): string {
  const allowedValues = fieldConfig.allowedValues;

  if (allowedValues && Array.isArray(allowedValues)) {
    return allowedValues
      .map((v: string | { value: string }) => {
        const value = typeof v === "string" ? v : v.value;
        return `"${value}"`;
      })
      .join(" | ");
  }
  return "string";
}

/**
 * Get the nested object type definition.
 * @param fieldConfig - The field configuration
 * @returns The nested type with used utility types
 */
function getNestedType(fieldConfig: KyselyFieldConfig): FieldTypeResult {
  const fields = fieldConfig.fields;
  if (!fields || typeof fields !== "object") {
    return {
      type: "string",
      usedUtilityTypes: { Timestamp: false, Serial: false },
    };
  }

  const fieldResults = Object.entries(fields).map(([fieldName, config]) => {
    const result = generateFieldType(config);
    const optional = config.required !== true ? "?" : "";
    return {
      fieldType: `${fieldName}${optional}: ${result.type}`,
      usedUtilityTypes: result.usedUtilityTypes,
    };
  });

  const aggregatedUtilityTypes = fieldResults.reduce(
    (acc, result) => ({
      Timestamp: acc.Timestamp || result.usedUtilityTypes.Timestamp,
      Serial: acc.Serial || result.usedUtilityTypes.Serial,
    }),
    { Timestamp: false, Serial: false },
  );

  const fieldTypes = fieldResults.map((r) => r.fieldType);
  const obj = `{\n  ${fieldTypes.join(";\n  ")}${fieldTypes.length > 0 ? ";" : ""}\n}`;

  const hasOptionalFields = Object.values(fields).some((config) => config.required !== true);
  const hasGeneratedFields = Object.values(fields).some(
    (config) =>
      config.hooks?.create || config.default !== undefined || config.optionalOnCreate === true,
  );
  if (aggregatedUtilityTypes.Timestamp || hasOptionalFields || hasGeneratedFields) {
    return { type: `ObjectColumnType<${obj}>`, usedUtilityTypes: aggregatedUtilityTypes };
  }
  return { type: obj, usedUtilityTypes: aggregatedUtilityTypes };
}

/**
 * Get the base Kysely type for a field (without array/null modifiers).
 * @param fieldConfig - The field configuration
 * @returns The base type with used utility types
 */
function getBaseType(fieldConfig: KyselyFieldConfig): FieldTypeResult {
  const fieldType = fieldConfig.type;
  const usedUtilityTypes = { Timestamp: false, Serial: false };

  if (fieldType === "enum") {
    return { type: getEnumType(fieldConfig), usedUtilityTypes };
  }
  if (fieldType === "nested") {
    return getNestedType(fieldConfig);
  }

  const type = mapFieldTypeToColumnType(fieldType);
  usedUtilityTypes.Timestamp = type === "Timestamp";

  return { type, usedUtilityTypes };
}

/**
 * Generate the complete field type including array and null modifiers.
 * @param fieldConfig - The field configuration
 * @returns The complete field type with used utility types
 */
function generateFieldType(fieldConfig: KyselyFieldConfig): FieldTypeResult {
  const baseTypeResult = getBaseType(fieldConfig);
  const usedUtilityTypes = { ...baseTypeResult.usedUtilityTypes };

  const isArray = fieldConfig.array === true;
  const isNullable = fieldConfig.required !== true;

  // A ColumnType-shaped alias and ObjectColumnType cannot be wrapped with [] for
  // arrays, because Kysely only resolves ColumnType at the top-level table
  // property. Use ArrayColumnType to keep the ColumnType at the top level.
  const isColumnTypeBase = COLUMN_TYPE_ALIASES.has(baseTypeResult.type);

  let finalType = baseTypeResult.type;
  if (isArray) {
    if (isColumnTypeBase || finalType.startsWith("ObjectColumnType<")) {
      finalType = `ArrayColumnType<${baseTypeResult.type}>`;
    } else {
      const needsParens = fieldConfig.type === "enum";
      finalType = needsParens ? `(${baseTypeResult.type})[]` : `${baseTypeResult.type}[]`;
    }
  }
  if (isNullable) {
    finalType = `${finalType} | null`;
  }

  if (fieldConfig.serial) {
    usedUtilityTypes.Serial = true;
    finalType = `Serial<${finalType}>`;
  }
  if (
    fieldConfig.hooks?.create ||
    fieldConfig.default !== undefined ||
    fieldConfig.optionalOnCreate === true
  ) {
    finalType = `Generated<${finalType}>`;
  }

  return { type: finalType, usedUtilityTypes };
}

/**
 * Generate the table interface.
 * @param name - Table name
 * @param fields - Field configurations keyed by field name
 * @returns The type definition and used utility types
 */
function generateTableInterface(
  name: string,
  fields: Record<string, KyselyFieldConfig>,
): {
  typeDef: string;
  usedUtilityTypes: UsedUtilityTypes;
} {
  const fieldEntries = Object.entries(fields).filter(([fieldName]) => fieldName !== "id");

  const fieldResults = fieldEntries.map(([fieldName, fieldConfig]) => ({
    fieldName,
    ...generateFieldType(fieldConfig),
  }));

  const fieldLines = [
    "id: Generated<string>;",
    ...fieldResults.map((result) => `${result.fieldName}: ${result.type};`),
  ];

  const aggregatedUtilityTypes = fieldResults.reduce(
    (acc, result) => ({
      Timestamp: acc.Timestamp || result.usedUtilityTypes.Timestamp,

      Serial: acc.Serial || result.usedUtilityTypes.Serial,
    }),
    { Timestamp: false, Serial: false },
  );

  const typeDef = multiline /* ts */ `
    ${name}: {
      ${fieldLines.join("\n")}
    }
  `;

  return { typeDef, usedUtilityTypes: aggregatedUtilityTypes };
}

/**
 * Generate KyselyTypeMetadata from field configurations.
 * @param name - Table name
 * @param fields - Field configurations keyed by field name
 * @returns Generated Kysely type metadata
 */
export function processKyselyFields(
  name: string,
  fields: Record<string, KyselyFieldConfig>,
): KyselyTypeMetadata {
  const result = generateTableInterface(name, fields);

  return {
    name,
    typeDef: result.typeDef,
    usedUtilityTypes: result.usedUtilityTypes,
  };
}

/**
 * Convert a TailorDBType into KyselyTypeMetadata.
 * @param type - Parsed TailorDB table
 * @returns Generated Kysely type metadata
 */
export async function processKyselyType(type: TailorDBType): Promise<KyselyTypeMetadata> {
  return processKyselyFields(
    type.name,
    Object.fromEntries(
      Object.entries(type.fields).map(([fieldName, parsedField]) => [
        fieldName,
        parsedField.config,
      ]),
    ),
  );
}

/**
 * Generate unified types file from multiple namespaces.
 * @param namespaceData - Namespace metadata
 * @returns Generated types file contents
 */
export function generateUnifiedKyselyTypes(namespaceData: KyselyNamespaceMetadata[]): string {
  if (namespaceData.length === 0) {
    return "";
  }

  // Aggregate used utility types from all namespaces
  const globalUsedUtilityTypes = namespaceData.reduce(
    (acc, ns) => ({
      Timestamp: acc.Timestamp || ns.usedUtilityTypes.Timestamp,
      Serial: acc.Serial || ns.usedUtilityTypes.Serial,
    }),
    { Timestamp: false, Serial: false },
  );

  const utilityTypeImports: string[] = ["type Generated"];
  if (globalUsedUtilityTypes.Timestamp) {
    utilityTypeImports.push("type Timestamp");
  }
  const hasObjectColumnType = namespaceData.some((ns) =>
    ns.types.some((t) => t.typeDef.includes("ObjectColumnType<")),
  );
  if (hasObjectColumnType) {
    utilityTypeImports.push("type ObjectColumnType");
  }
  const hasArrayColumnType = namespaceData.some((ns) =>
    ns.types.some((t) => t.typeDef.includes("ArrayColumnType<")),
  );
  if (hasArrayColumnType) {
    utilityTypeImports.push("type ArrayColumnType");
  }
  if (globalUsedUtilityTypes.Serial) {
    utilityTypeImports.push("type Serial");
  }

  const importsSection = multiline /* ts */ `
    import {
      createGetDB,
      ${utilityTypeImports.join(",\n")},
      type NamespaceDB,
      type NamespaceInsertable,
      type NamespaceSelectable,
      type NamespaceTable,
      type NamespaceTableName,
      type NamespaceTransaction,
      type NamespaceUpdateable,
    } from "@tailor-platform/sdk/kysely";
  `;

  // Generate Namespace interface with multiple namespaces
  const namespaceInterfaces = namespaceData
    .map(({ namespace, types }) => {
      const typeDefsWithIndent = types
        .map((type) => {
          return type.typeDef
            .split("\n")
            .map((line) => (line.trim() ? `    ${line}` : ""))
            .join("\n");
        })
        .join("\n\n");

      return `  "${namespace}": {\n${typeDefsWithIndent}\n  }`;
    })
    .join(",\n");

  const namespaceInterface = `export interface Namespace {\n${namespaceInterfaces}\n}`;

  const getDBFunction = multiline /* ts */ `
    export const getDB = createGetDB<Namespace>();

    export type DB<N extends keyof Namespace = keyof Namespace> = NamespaceDB<Namespace, N>;
  `;

  const utilityTypeExports = multiline /* ts */ `
    export type Transaction<K extends keyof Namespace | DB = keyof Namespace> =
      NamespaceTransaction<Namespace, K>;

    type TableName = NamespaceTableName<Namespace>;
    export type Table<T extends TableName> = NamespaceTable<Namespace, T>;

    export type Insertable<T extends TableName> = NamespaceInsertable<Namespace, T>;
    export type Selectable<T extends TableName> = NamespaceSelectable<Namespace, T>;
    export type Updateable<T extends TableName> = NamespaceUpdateable<Namespace, T>;
  `;

  return (
    [importsSection, namespaceInterface, getDBFunction, utilityTypeExports].join("\n\n") + "\n"
  );
}
