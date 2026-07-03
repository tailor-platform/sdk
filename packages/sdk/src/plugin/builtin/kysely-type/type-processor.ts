import multiline from "#/utils/multiline";
import { type KyselyNamespaceMetadata, type KyselyTypeMetadata } from "./types";
import type { OperatorFieldConfig, TailorDBType } from "#/parser/service/tailordb/types";

type UsedUtilityTypes = {
  Timestamp: boolean;
  Serial: boolean;
  DateString: boolean;
  DecimalString: boolean;
  TimeString: boolean;
};

function createUsedUtilityTypes(): UsedUtilityTypes {
  return {
    Timestamp: false,
    Serial: false,
    DateString: false,
    DecimalString: false,
    TimeString: false,
  };
}

function mergeUsedUtilityTypes(
  results: { usedUtilityTypes: UsedUtilityTypes }[],
): UsedUtilityTypes {
  return results.reduce(
    (acc, result) => ({
      Timestamp: acc.Timestamp || result.usedUtilityTypes.Timestamp,
      Serial: acc.Serial || result.usedUtilityTypes.Serial,
      DateString: acc.DateString || result.usedUtilityTypes.DateString,
      DecimalString: acc.DecimalString || result.usedUtilityTypes.DecimalString,
      TimeString: acc.TimeString || result.usedUtilityTypes.TimeString,
    }),
    createUsedUtilityTypes(),
  );
}

type FieldTypeResult = {
  type: string;
  usedUtilityTypes: UsedUtilityTypes;
};

/**
 * Get the enum type definition.
 * @param fieldConfig - The field configuration
 * @returns The enum type as a string union
 */
function getEnumType(fieldConfig: OperatorFieldConfig): string {
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
function getNestedType(fieldConfig: OperatorFieldConfig): FieldTypeResult {
  const fields = fieldConfig.fields;
  if (!fields || typeof fields !== "object") {
    return {
      type: "string",
      usedUtilityTypes: createUsedUtilityTypes(),
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

  const aggregatedUtilityTypes = mergeUsedUtilityTypes(fieldResults);

  const fieldTypes = fieldResults.map((r) => r.fieldType);
  const obj = `{\n  ${fieldTypes.join(";\n  ")}${fieldTypes.length > 0 ? ";" : ""}\n}`;

  const hasOptionalFields = Object.values(fields).some((config) => config.required !== true);
  if (aggregatedUtilityTypes.Timestamp || hasOptionalFields) {
    return { type: `ObjectColumnType<${obj}>`, usedUtilityTypes: aggregatedUtilityTypes };
  }
  return { type: obj, usedUtilityTypes: aggregatedUtilityTypes };
}

/**
 * Get the base Kysely type for a field (without array/null modifiers).
 * @param fieldConfig - The field configuration
 * @returns The base type with used utility types
 */
function getBaseType(fieldConfig: OperatorFieldConfig): FieldTypeResult {
  const fieldType = fieldConfig.type;
  const usedUtilityTypes = createUsedUtilityTypes();

  let type: string;
  switch (fieldType) {
    case "uuid":
      type = "UUIDString";
      break;
    case "string":
      type = "string";
      break;
    case "decimal":
      usedUtilityTypes.DecimalString = true;
      type = "DecimalString";
      break;
    case "integer":
    case "float":
      type = "number";
      break;
    case "datetime":
      usedUtilityTypes.Timestamp = true;
      type = "Timestamp";
      break;
    case "date":
      usedUtilityTypes.DateString = true;
      type = "DateString";
      break;
    case "time":
      usedUtilityTypes.TimeString = true;
      type = "TimeString";
      break;
    case "bool":
    case "boolean":
      type = "boolean";
      break;
    case "enum":
      type = getEnumType(fieldConfig);
      break;
    case "nested": {
      const nestedResult = getNestedType(fieldConfig);
      return nestedResult;
    }
    default:
      type = "string";
      break;
  }

  return { type, usedUtilityTypes };
}

/**
 * Generate the complete field type including array and null modifiers.
 * @param fieldConfig - The field configuration
 * @returns The complete field type with used utility types
 */
function generateFieldType(fieldConfig: OperatorFieldConfig): FieldTypeResult {
  const baseTypeResult = getBaseType(fieldConfig);
  const usedUtilityTypes = { ...baseTypeResult.usedUtilityTypes };

  const isArray = fieldConfig.array === true;
  const isNullable = fieldConfig.required !== true;

  // Types that use ColumnType internally (Timestamp, ObjectColumnType) cannot be
  // directly wrapped with [] for arrays, because Kysely only resolves ColumnType at
  // the top-level table property. Use ArrayColumnType/ObjectArrayColumnType to keep
  // the ColumnType at the top level with arrays inside.
  const columnTypeBaseTypes = new Set(["Timestamp"]);
  const isColumnTypeBase = columnTypeBaseTypes.has(baseTypeResult.type);

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
  if (fieldConfig.hooks?.create) {
    finalType = `Generated<${finalType}>`;
  }

  return { type: finalType, usedUtilityTypes };
}

/**
 * Generate the table interface.
 * @param type - The parsed TailorDB type
 * @returns The type definition and used utility types
 */
function generateTableInterface(type: TailorDBType): {
  typeDef: string;
  usedUtilityTypes: UsedUtilityTypes;
} {
  const fieldEntries = Object.entries(type.fields).filter(([fieldName]) => fieldName !== "id");

  const fieldResults = fieldEntries.map(([fieldName, parsedField]) => ({
    fieldName,
    ...generateFieldType(parsedField.config),
  }));

  const fields = [
    "id: Generated<UUIDString>;",
    ...fieldResults.map((result) => `${result.fieldName}: ${result.type};`),
  ];

  const aggregatedUtilityTypes = mergeUsedUtilityTypes(fieldResults);

  const typeDef = multiline /* ts */ `
    ${type.name}: {
      ${fields.join("\n")}
    }
  `;

  return { typeDef, usedUtilityTypes: aggregatedUtilityTypes };
}

/**
 * Convert a TailorDBType into KyselyTypeMetadata.
 * @param type - Parsed TailorDB type
 * @returns Generated Kysely type metadata
 */
export async function processKyselyType(type: TailorDBType): Promise<KyselyTypeMetadata> {
  const result = generateTableInterface(type);

  return {
    name: type.name,
    typeDef: result.typeDef,
    usedUtilityTypes: result.usedUtilityTypes,
  };
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
      DateString: acc.DateString || ns.usedUtilityTypes.DateString,
      DecimalString: acc.DecimalString || ns.usedUtilityTypes.DecimalString,
      TimeString: acc.TimeString || ns.usedUtilityTypes.TimeString,
    }),
    createUsedUtilityTypes(),
  );

  const utilityTypeImports: string[] = ["type Generated", "type UUIDString"];
  if (globalUsedUtilityTypes.Timestamp) {
    utilityTypeImports.push("type Timestamp");
  }
  if (globalUsedUtilityTypes.DateString) {
    utilityTypeImports.push("type DateString");
  }
  if (globalUsedUtilityTypes.DecimalString) {
    utilityTypeImports.push("type DecimalString");
  }
  if (globalUsedUtilityTypes.TimeString) {
    utilityTypeImports.push("type TimeString");
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
