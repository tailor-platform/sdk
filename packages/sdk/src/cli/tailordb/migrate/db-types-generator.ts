/**
 * DB types generator for TailorDB migrations
 *
 * Generates db.ts file containing Kysely Transaction types
 * based on the schema snapshot at a specific migration point.
 */

import * as fs from "node:fs/promises";
import { getMigrationFilePath } from "./types";
import type { SchemaSnapshot, SnapshotFieldConfig, SnapshotType, MigrationDiff } from "./types";

/**
 * Information about enum value changes
 */
interface EnumValueChange {
  /** Allowed values before the change */
  beforeValues: string[];
  /** Allowed values after the change */
  afterValues: string[];
}

/**
 * Information about breaking change fields that need special handling
 */
interface BreakingChangeFieldInfo {
  /** Map of typeName -> Set of fieldNames that are changing from optional to required */
  optionalToRequired: Map<string, Set<string>>;
  /** Map of typeName -> Map of fieldName -> SnapshotFieldConfig for newly added required fields */
  addedRequiredFields: Map<string, Map<string, SnapshotFieldConfig>>;
  /** Map of typeName -> Map of fieldName -> EnumValueChange for enum value changes */
  enumValueChanges: Map<string, Map<string, EnumValueChange>>;
}

/**
 * Extract breaking change field information from diff
 * @param {MigrationDiff} diff - Migration diff
 * @returns {BreakingChangeFieldInfo} Breaking change field information
 */
function extractBreakingChangeFields(diff: MigrationDiff): BreakingChangeFieldInfo {
  const optionalToRequired = new Map<string, Set<string>>();
  const addedRequiredFields = new Map<string, Map<string, SnapshotFieldConfig>>();
  const enumValueChanges = new Map<string, Map<string, EnumValueChange>>();

  for (const change of diff.changes) {
    if (change.kind === "field_modified" && change.fieldName) {
      const before = change.before as SnapshotFieldConfig | undefined;
      const after = change.after as SnapshotFieldConfig | undefined;

      // Check if this is an optional -> required change
      if (before && after && !before.required && after.required) {
        if (!optionalToRequired.has(change.typeName)) {
          optionalToRequired.set(change.typeName, new Set());
        }
        optionalToRequired.get(change.typeName)!.add(change.fieldName);
      }

      // Check if this is an enum value change
      if (
        before &&
        after &&
        before.type === "enum" &&
        after.type === "enum" &&
        before.allowedValues &&
        after.allowedValues
      ) {
        // Check if there are any differences in allowed values
        const beforeSet = new Set(before.allowedValues);
        const afterSet = new Set(after.allowedValues);
        const hasChanges =
          before.allowedValues.some((v) => !afterSet.has(v)) ||
          after.allowedValues.some((v) => !beforeSet.has(v));

        if (hasChanges) {
          if (!enumValueChanges.has(change.typeName)) {
            enumValueChanges.set(change.typeName, new Map());
          }
          enumValueChanges.get(change.typeName)!.set(change.fieldName, {
            beforeValues: before.allowedValues,
            afterValues: after.allowedValues,
          });
        }
      }
    } else if (change.kind === "field_added" && change.fieldName) {
      const after = change.after as SnapshotFieldConfig | undefined;

      // Required field added is a breaking change - add it as optional in db.ts
      // so migration script can set values for existing records
      if (after && after.required) {
        if (!addedRequiredFields.has(change.typeName)) {
          addedRequiredFields.set(change.typeName, new Map());
        }
        addedRequiredFields.get(change.typeName)!.set(change.fieldName, after);
      }
    }
  }

  return { optionalToRequired, addedRequiredFields, enumValueChanges };
}

/**
 * Generate the complete db.ts file content from a schema snapshot
 * @param {SchemaSnapshot} snapshot - Schema snapshot to generate types from
 * @param {MigrationDiff} [diff] - Optional migration diff for breaking change info
 * @returns {string} Generated db.ts file contents
 */
function generateDbTypesFromSnapshot(snapshot: SchemaSnapshot, diff?: MigrationDiff): string {
  const types = Object.values(snapshot.types);
  if (types.length === 0) {
    return generateEmptyDbTypes(snapshot.namespace);
  }

  // Extract breaking change field information
  const breakingChangeFields = diff
    ? extractBreakingChangeFields(diff)
    : {
        optionalToRequired: new Map(),
        addedRequiredFields: new Map(),
        enumValueChanges: new Map(),
      };

  // Track which utility types are used
  const usedUtilityTypes = new Set<"Timestamp" | "Serial">();

  // Generate type definitions
  const typeDefinitions: string[] = [];
  for (const type of types) {
    const result = generateTableType(type, breakingChangeFields);
    if (result.usedTimestamp) usedUtilityTypes.add("Timestamp");
    typeDefinitions.push(result.typeDef);
  }

  // Build imports
  // ColumnType is always needed for Generated and Timestamp utility types
  const imports: string[] = ["type ColumnType", "type Transaction as KyselyTransaction"];

  // Build utility type declarations
  const utilityTypeDeclarations: string[] = [];
  if (usedUtilityTypes.has("Timestamp")) {
    utilityTypeDeclarations.push(
      "type Timestamp = ColumnType<Date, Date | string, Date | string>;",
    );
  }
  utilityTypeDeclarations.push(
    "type Generated<T> = T extends ColumnType<infer S, infer I, infer U>\n  ? ColumnType<S, I | undefined, U>\n  : ColumnType<T, T | undefined, T>;",
  );
  if (usedUtilityTypes.has("Serial")) {
    utilityTypeDeclarations.push("type Serial<T = string | number> = ColumnType<T, never, never>;");
  }

  // Build output
  const lines: string[] = [
    "/**",
    " * Auto-generated Kysely types for migration script.",
    " * These types reflect the database schema state at this migration point.",
    " *",
    " * DO NOT EDIT - This file is auto-generated by the migration system.",
    " */",
    "",
    `import { ${imports.join(", ")} } from "kysely";`,
    "",
    ...utilityTypeDeclarations,
    "",
    "interface Database {",
    ...typeDefinitions,
    "}",
    "",
    "export type Transaction = KyselyTransaction<Database>;",
  ];

  return lines.join("\n") + "\n";
}

/**
 * Generate an empty db.ts file for migrations with no types
 * @param {string} namespace - Namespace name
 * @returns {string} Empty db.ts file contents
 */
function generateEmptyDbTypes(namespace: string): string {
  return (
    [
      "/**",
      " * Auto-generated Kysely types for migration script.",
      ` * Namespace: ${namespace}`,
      " *",
      " * DO NOT EDIT - This file is auto-generated by the migration system.",
      " */",
      "",
      'import { type Transaction as KyselyTransaction } from "kysely";',
      "",
      "// eslint-disable-next-line @typescript-eslint/no-empty-object-type",
      "interface Database {}",
      "",
      "export type Transaction = KyselyTransaction<Database>;",
    ].join("\n") + "\n"
  );
}

/**
 * Generate table type definition from a snapshot type
 * @param {SnapshotType} type - Snapshot type
 * @param {BreakingChangeFieldInfo} breakingChangeFields - Breaking change field info
 * @returns {{ typeDef: string; usedTimestamp: boolean; usedColumnType: boolean }} Generated type and utility type usage
 */
function generateTableType(
  type: SnapshotType,
  breakingChangeFields: BreakingChangeFieldInfo,
): {
  typeDef: string;
  usedTimestamp: boolean;
  usedColumnType: boolean;
} {
  const fieldLines: string[] = [];
  let usedTimestamp = false;
  let usedColumnType = false;

  // Add id field first
  fieldLines.push("    id: Generated<string>;");

  // Get fields that are changing from optional to required for this type
  const optionalToRequiredFields =
    breakingChangeFields.optionalToRequired.get(type.name) || new Set();

  // Get newly added required fields for this type
  const addedRequiredFields = breakingChangeFields.addedRequiredFields.get(type.name) || new Map();

  // Get enum value changes for this type
  const enumValueChangesForType = breakingChangeFields.enumValueChanges.get(type.name) || new Map();

  for (const [fieldName, fieldConfig] of Object.entries(type.fields)) {
    if (fieldName === "id") continue;

    const isOptionalToRequired = optionalToRequiredFields.has(fieldName);
    const enumValueChange = enumValueChangesForType.get(fieldName);
    const result = generateFieldType(fieldConfig, isOptionalToRequired, enumValueChange);
    fieldLines.push(`    ${fieldName}: ${result.type};`);
    usedTimestamp = usedTimestamp || result.usedTimestamp;
    usedColumnType = usedColumnType || result.usedColumnType;
  }

  // Add newly added required fields with ColumnType (same as optional→required)
  // These fields are added as nullable in pre-migration, then become required in post-migration
  for (const [fieldName, fieldConfig] of addedRequiredFields) {
    // Treat as optional→required change (isOptionalToRequired: true)
    const result = generateFieldType(fieldConfig, true, undefined);
    fieldLines.push(`    ${fieldName}: ${result.type};`);
    usedTimestamp = usedTimestamp || result.usedTimestamp;
    usedColumnType = usedColumnType || result.usedColumnType;
  }

  const typeDef = `  ${type.name}: {\n${fieldLines.join("\n")}\n  }`;

  return { typeDef, usedTimestamp, usedColumnType };
}

function mapToTsType(fieldType: string): {
  type: string;
  usedTimestamp: boolean;
} {
  switch (fieldType) {
    case "uuid":
    case "string":
      return { type: "string", usedTimestamp: false };
    case "integer":
    case "float":
    case "number":
      return { type: "number", usedTimestamp: false };
    case "date":
    case "datetime":
      return { type: "Timestamp", usedTimestamp: true };
    case "bool":
    case "boolean":
      return { type: "boolean", usedTimestamp: false };
    default:
      return { type: "string", usedTimestamp: false };
  }
}

function formatEnumUnion(values: string[]): string {
  return values.map((v) => `"${v}"`).join(" | ");
}

function generateEnumChangeColumnType(
  enumValueChange: EnumValueChange,
  config: SnapshotFieldConfig,
): string {
  const allValues = [...new Set([...enumValueChange.beforeValues, ...enumValueChange.afterValues])];
  const selectType = formatEnumUnion(allValues);
  const afterType = formatEnumUnion(enumValueChange.afterValues);

  if (config.array && !config.required) {
    return `ColumnType<(${selectType})[] | null, (${afterType})[] | null, (${afterType})[] | null>`;
  }
  if (config.array) {
    return `ColumnType<(${selectType})[], (${afterType})[], (${afterType})[]>`;
  }
  if (!config.required) {
    return `ColumnType<(${selectType}) | null, (${afterType}) | null, (${afterType}) | null>`;
  }
  return `ColumnType<${selectType}, ${afterType}, ${afterType}>`;
}

/**
 * Generate field type from snapshot field config
 * @param {SnapshotFieldConfig} config - Field configuration
 * @param {boolean} isOptionalToRequired - Whether this field is changing from optional to required
 * @param {EnumValueChange} [enumValueChange] - Enum value change info if applicable
 * @returns {{ type: string; usedTimestamp: boolean; usedColumnType: boolean }} Generated type string and utility type usage
 */
function generateFieldType(
  config: SnapshotFieldConfig,
  isOptionalToRequired: boolean,
  enumValueChange?: EnumValueChange,
): {
  type: string;
  usedTimestamp: boolean;
  usedColumnType: boolean;
} {
  // Handle enum value changes specially
  if (enumValueChange) {
    return {
      type: generateEnumChangeColumnType(enumValueChange, config),
      usedTimestamp: false,
      usedColumnType: true,
    };
  }

  // Get base type
  let baseType: string;
  let usedTimestamp = false;

  if (config.type === "enum") {
    baseType =
      config.allowedValues && config.allowedValues.length > 0
        ? formatEnumUnion(config.allowedValues)
        : "string";
  } else {
    const mapped = mapToTsType(config.type);
    baseType = mapped.type;
    usedTimestamp = mapped.usedTimestamp;
  }

  // Apply array modifier
  let type = baseType;
  if (config.array) {
    const needsParens =
      config.type === "enum" && config.allowedValues && config.allowedValues.length > 0;
    type = needsParens ? `(${baseType})[]` : `${baseType}[]`;
  }

  // Handle nullable/required modifiers
  if (isOptionalToRequired) {
    // For fields changing from optional to required:
    // SELECT returns T | null (existing data might be null)
    // INSERT/UPDATE requires T (must provide a value)
    return {
      type: `ColumnType<${type} | null, ${type}, ${type}>`,
      usedTimestamp,
      usedColumnType: true,
    };
  }

  if (!config.required) {
    type = `${type} | null`;
  }

  return { type, usedTimestamp, usedColumnType: false };
}

/**
 * Write db.ts file for a migration
 * @param {SchemaSnapshot} snapshot - Schema snapshot to generate types from
 * @param {string} migrationsDir - Migrations directory path
 * @param {number} migrationNumber - Migration number
 * @param {MigrationDiff} [diff] - Optional migration diff for breaking change info
 * @returns {Promise<string>} Path to the written file
 */
export async function writeDbTypesFile(
  snapshot: SchemaSnapshot,
  migrationsDir: string,
  migrationNumber: number,
  diff?: MigrationDiff,
): Promise<string> {
  const content = generateDbTypesFromSnapshot(snapshot, diff);
  const filePath = getMigrationFilePath(migrationsDir, migrationNumber, "db");
  await fs.writeFile(filePath, content);
  return filePath;
}
