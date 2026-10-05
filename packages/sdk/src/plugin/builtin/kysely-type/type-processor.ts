import { COLUMN_TYPE_ALIASES, mapFieldTypeToColumnType } from "#/utils/field-column-type";
import multiline from "#/utils/multiline";
import {
  type KyselyFieldConfig,
  type KyselyNamespaceMetadata,
  type KyselyTypeMetadata,
  type UsedUtilityTypes,
} from "./types";
import type { TailorDBType } from "#/parser/service/tailordb/types";

type FieldTypeResult = {
  type: string;
  usedUtilityTypes: UsedUtilityTypes;
};

function emptyUsedUtilityTypes(): UsedUtilityTypes {
  return {
    Timestamp: false,
    TemporalDate: false,
    TemporalInstant: false,
    TemporalTime: false,
    Serial: false,
    ObjectColumnType: false,
    ArrayColumnType: false,
  };
}

function mergeUsedUtilityTypes(a: UsedUtilityTypes, b: UsedUtilityTypes): UsedUtilityTypes {
  return {
    Timestamp: a.Timestamp || b.Timestamp,
    TemporalDate: a.TemporalDate || b.TemporalDate,
    TemporalInstant: a.TemporalInstant || b.TemporalInstant,
    TemporalTime: a.TemporalTime || b.TemporalTime,
    Serial: a.Serial || b.Serial,
    ObjectColumnType: a.ObjectColumnType || b.ObjectColumnType,
    ArrayColumnType: a.ArrayColumnType || b.ArrayColumnType,
  };
}

/**
 * Whether a utility-type usage record uses any `ColumnType`-shaped alias.
 * @param usedUtilityTypes - Utility-type usage record to check
 * @returns Whether any `ColumnType`-shaped alias is used
 */
function usesColumnTypeAlias(usedUtilityTypes: UsedUtilityTypes): boolean {
  return (
    usedUtilityTypes.Timestamp ||
    usedUtilityTypes.TemporalDate ||
    usedUtilityTypes.TemporalInstant ||
    usedUtilityTypes.TemporalTime
  );
}

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
 * @param temporal - Whether date/datetime/time fields resolve to their Temporal column
 * types instead of their `Date`/`string` defaults
 * @returns The nested type with used utility types
 */
function getNestedType(fieldConfig: KyselyFieldConfig, temporal: boolean): FieldTypeResult {
  const fields = fieldConfig.fields;
  if (!fields || typeof fields !== "object") {
    return {
      type: "string",
      usedUtilityTypes: emptyUsedUtilityTypes(),
    };
  }

  const fieldResults = Object.entries(fields).map(([fieldName, config]) => {
    const result = generateFieldType(config, temporal, true);
    const optional = config.required !== true ? "?" : "";
    return {
      fieldType: `${fieldName}${optional}: ${result.type}`,
      usedUtilityTypes: result.usedUtilityTypes,
    };
  });

  const aggregatedUtilityTypes = fieldResults.reduce(
    (acc, result) => mergeUsedUtilityTypes(acc, result.usedUtilityTypes),
    emptyUsedUtilityTypes(),
  );

  const fieldTypes = fieldResults.map((r) => r.fieldType);
  const obj = `{\n  ${fieldTypes.join(";\n  ")}${fieldTypes.length > 0 ? ";" : ""}\n}`;

  const hasOptionalFields = Object.values(fields).some((config) => config.required !== true);
  const hasGeneratedFields = Object.values(fields).some(
    (config) =>
      config.hooks?.create || config.default !== undefined || config.optionalOnCreate === true,
  );
  if (usesColumnTypeAlias(aggregatedUtilityTypes) || hasOptionalFields || hasGeneratedFields) {
    return {
      type: `ObjectColumnType<${obj}>`,
      usedUtilityTypes: { ...aggregatedUtilityTypes, ObjectColumnType: true },
    };
  }
  return { type: obj, usedUtilityTypes: aggregatedUtilityTypes };
}

/**
 * Get the base Kysely type for a field (without array/null modifiers).
 * @param fieldConfig - The field configuration
 * @param temporal - Whether date/datetime/time fields resolve to their Temporal column
 * types instead of their `Date`/`string` defaults
 * @param nested - Whether the field is inside an object
 * @returns The base type with used utility types
 */
function getBaseType(
  fieldConfig: KyselyFieldConfig,
  temporal: boolean,
  nested: boolean,
): FieldTypeResult {
  const fieldType = fieldConfig.type;
  const usedUtilityTypes = emptyUsedUtilityTypes();

  if (fieldType === "enum") {
    return { type: getEnumType(fieldConfig), usedUtilityTypes };
  }
  if (fieldType === "nested") {
    return getNestedType(fieldConfig, temporal);
  }

  const type = mapFieldTypeToColumnType(fieldType, temporal && !(nested && fieldType === "time"));
  switch (type) {
    case "Timestamp":
      usedUtilityTypes.Timestamp = true;
      break;
    case "TemporalDate":
      usedUtilityTypes.TemporalDate = true;
      break;
    case "TemporalInstant":
      usedUtilityTypes.TemporalInstant = true;
      break;
    case "TemporalTime":
      usedUtilityTypes.TemporalTime = true;
      break;
    case "string":
    case "number":
    case "boolean":
      break;
  }

  return { type, usedUtilityTypes };
}

/**
 * Generate the complete field type including array and null modifiers.
 * @param fieldConfig - The field configuration
 * @param temporal - Whether date/datetime/time fields resolve to their Temporal column
 * types instead of their `Date`/`string` defaults
 * @param nested - Whether the field is inside an object
 * @returns The complete field type with used utility types
 */
function generateFieldType(
  fieldConfig: KyselyFieldConfig,
  temporal: boolean,
  nested = false,
): FieldTypeResult {
  const baseTypeResult = getBaseType(fieldConfig, temporal, nested);
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
      usedUtilityTypes.ArrayColumnType = true;
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
 * @param temporal - Whether date/datetime/time fields resolve to their Temporal column
 * types instead of their `Date`/`string` defaults
 * @returns The type definition and used utility types
 */
function generateTableInterface(
  name: string,
  fields: Record<string, KyselyFieldConfig>,
  temporal: boolean,
): {
  typeDef: string;
  usedUtilityTypes: UsedUtilityTypes;
} {
  const fieldEntries = Object.entries(fields).filter(([fieldName]) => fieldName !== "id");

  const fieldResults = fieldEntries.map(([fieldName, fieldConfig]) => ({
    fieldName,
    ...generateFieldType(fieldConfig, temporal),
  }));

  const fieldLines = [
    "id: Generated<string>;",
    ...fieldResults.map((result) => `${result.fieldName}: ${result.type};`),
  ];

  const aggregatedUtilityTypes = fieldResults.reduce(
    (acc, result) => mergeUsedUtilityTypes(acc, result.usedUtilityTypes),
    emptyUsedUtilityTypes(),
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
 * @param temporal - Whether date/datetime/time fields resolve to their Temporal column
 * types instead of their `Date`/`string` defaults. Defaults to `false`.
 * @returns Generated Kysely type metadata
 */
export function processKyselyFields(
  name: string,
  fields: Record<string, KyselyFieldConfig>,
  temporal = false,
): KyselyTypeMetadata {
  const result = generateTableInterface(name, fields, temporal);

  return {
    name,
    typeDef: result.typeDef,
    usedUtilityTypes: result.usedUtilityTypes,
  };
}

/**
 * Convert a TailorDBType into KyselyTypeMetadata.
 * @param type - Parsed TailorDB table
 * @param temporal - Whether date/datetime/time fields resolve to their Temporal column
 * types instead of their `Date`/`string` defaults. Defaults to `false`.
 * @returns Generated Kysely type metadata
 */
export async function processKyselyType(
  type: TailorDBType,
  temporal = false,
): Promise<KyselyTypeMetadata> {
  return processKyselyFields(
    type.name,
    Object.fromEntries(
      Object.entries(type.fields).map(([fieldName, parsedField]) => [
        fieldName,
        parsedField.config,
      ]),
    ),
    temporal,
  );
}

/**
 * Generate unified types file from multiple namespaces.
 * @param namespaceData - Namespace metadata
 * @param temporal - Whether `kyselyTypePlugin` was configured with `{ temporal: true }`;
 * passed to `createGetDB` so the generated `getDB` always reads back the Temporal values
 * the tables above are typed with. Defaults to `false`.
 * @returns Generated types file contents
 */
export function generateUnifiedKyselyTypes(
  namespaceData: KyselyNamespaceMetadata[],
  temporal = false,
): string {
  if (namespaceData.length === 0) {
    return "";
  }

  // Aggregate used utility types from all namespaces
  const globalUsedUtilityTypes = namespaceData
    .flatMap((ns) => ns.types)
    .reduce(
      (acc, type) => mergeUsedUtilityTypes(acc, type.usedUtilityTypes),
      emptyUsedUtilityTypes(),
    );

  const utilityTypeImports: string[] = ["type Generated"];
  if (globalUsedUtilityTypes.Timestamp) {
    utilityTypeImports.push("type Timestamp");
  }
  if (globalUsedUtilityTypes.TemporalDate) {
    utilityTypeImports.push("type TemporalDate");
  }
  if (globalUsedUtilityTypes.TemporalInstant) {
    utilityTypeImports.push("type TemporalInstant");
  }
  if (globalUsedUtilityTypes.TemporalTime) {
    utilityTypeImports.push("type TemporalTime");
  }
  if (globalUsedUtilityTypes.ObjectColumnType) {
    utilityTypeImports.push("type ObjectColumnType");
  }
  if (globalUsedUtilityTypes.ArrayColumnType) {
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
    export const getDB = createGetDB<Namespace>(${temporal ? "{ temporal: true }" : ""});

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
