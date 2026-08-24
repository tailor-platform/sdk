/**
 * DB types generator for TailorDB migrations
 *
 * Generates db.ts file containing Kysely Transaction types
 * based on the schema snapshot at a specific migration point.
 */

import * as fs from "node:fs/promises";
import { assertDefined } from "#/utils/assert";
import { mapFieldTypeToColumnType } from "#/utils/field-column-type";
import {
  getMigrationFilePath,
  type SchemaSnapshot,
  type SnapshotFieldConfig,
  type TailorDBSnapshotType,
} from "./snapshot";
import type { MigrationDiff } from "./diff-calculator";
import type { ExpandContractPlan } from "./expand-contract";

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
  /** Map of tableName -> Set of fieldNames that are changing from optional to required */
  optionalToRequired: Map<string, Set<string>>;
  /** Map of tableName -> Map of fieldName -> SnapshotFieldConfig for newly added required fields */
  addedRequiredFields: Map<string, Map<string, SnapshotFieldConfig>>;
  /** Map of tableName -> Map of fieldName -> EnumValueChange for enum value changes */
  enumValueChanges: Map<string, Map<string, EnumValueChange>>;
  /** Map of tableName -> Map of new fieldName -> SnapshotFieldConfig for renamed fields */
  renamedFields: Map<string, Map<string, SnapshotFieldConfig>>;
  /** Map of tableName -> Set of fieldNames a conversion script clears */
  clearedFields: Map<string, Set<string>>;
  /** Map of new tableName -> TailorDBSnapshotType for renamed tables */
  renamedTypes: Map<string, TailorDBSnapshotType>;
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
  const renamedFields = new Map<string, Map<string, SnapshotFieldConfig>>();
  const renamedTypes = new Map<string, TailorDBSnapshotType>();

  for (const change of diff.changes) {
    if (change.kind === "field_modified" || change.kind === "field_type_modified") {
      const { before, after } = change;

      // Check if this is an optional -> required change
      if (!before.required && after.required) {
        if (!optionalToRequired.has(change.tableName)) {
          optionalToRequired.set(change.tableName, new Set());
        }
        assertDefined(
          optionalToRequired.get(change.tableName),
          "optionalToRequired entry missing",
        ).add(change.fieldName);
      }

      // Check if this is an enum value change
      if (
        before.type === "enum" &&
        after.type === "enum" &&
        before.allowedValues &&
        after.allowedValues
      ) {
        // Check if there are any differences in allowed values
        const beforeValues = before.allowedValues.map((v) => v.value);
        const afterValues = after.allowedValues.map((v) => v.value);
        const beforeSet = new Set(beforeValues);
        const afterSet = new Set(afterValues);
        const hasChanges =
          beforeValues.some((v) => !afterSet.has(v)) || afterValues.some((v) => !beforeSet.has(v));

        if (hasChanges) {
          if (!enumValueChanges.has(change.tableName)) {
            enumValueChanges.set(change.tableName, new Map());
          }
          assertDefined(
            enumValueChanges.get(change.tableName),
            "enumValueChanges entry missing",
          ).set(change.fieldName, {
            beforeValues,
            afterValues,
          });
        }
      }
    } else if (change.kind === "field_added") {
      const { after } = change;

      // Required field added is a breaking change - add it as optional in db.ts
      // so migration script can set values for existing records
      if (after.required) {
        if (!addedRequiredFields.has(change.tableName)) {
          addedRequiredFields.set(change.tableName, new Map());
        }
        assertDefined(
          addedRequiredFields.get(change.tableName),
          "addedRequiredFields entry missing",
        ).set(change.fieldName, after);
      }
    } else if (change.kind === "field_renamed") {
      // The new field is missing from the pre-migration snapshot; inject it so
      // the copy script can write it (the old field stays readable as-is).
      if (!renamedFields.has(change.tableName)) {
        renamedFields.set(change.tableName, new Map());
      }
      assertDefined(renamedFields.get(change.tableName), "renamedFields entry missing").set(
        change.fieldName,
        change.after,
      );
    } else if (change.kind === "table_renamed") {
      // The new table is missing from the pre-migration snapshot; inject it so
      // the copy script can insert into it (the old type stays readable as-is).
      renamedTypes.set(change.tableName, change.after);
    }
  }

  return {
    optionalToRequired,
    addedRequiredFields,
    enumValueChanges,
    renamedFields,
    clearedFields: new Map<string, Set<string>>(),
    renamedTypes,
  };
}

/**
 * Generate the complete db.ts file content from a schema snapshot
 * @param {SchemaSnapshot} snapshot - Schema snapshot to generate types from
 * @param {MigrationDiff} [diff] - Optional migration diff for breaking change info
 * @param expandPlans - Field changes carried through temporary fields
 * @returns {string} Generated db.ts file contents
 */
function generateDbTypesFromSnapshot(
  snapshot: SchemaSnapshot,
  diff?: MigrationDiff,
  expandPlans: readonly ExpandContractPlan[] = [],
): string {
  // Extract breaking change field information
  const breakingChangeFields = diff
    ? extractBreakingChangeFields(diff)
    : {
        optionalToRequired: new Map(),
        addedRequiredFields: new Map(),
        enumValueChanges: new Map(),
        renamedFields: new Map<string, Map<string, SnapshotFieldConfig>>(),
        clearedFields: new Map<string, Set<string>>(),
        renamedTypes: new Map<string, TailorDBSnapshotType>(),
      };

  // The temporary field is absent from the pre-migration snapshot; inject it so
  // the conversion script can write it, as a renamed field's new name is.
  for (const plan of expandPlans) {
    const injected =
      breakingChangeFields.renamedFields.get(plan.tableName) ??
      new Map<string, SnapshotFieldConfig>();
    injected.set(plan.tempFieldName, { ...plan.after, required: false, unique: false });
    breakingChangeFields.renamedFields.set(plan.tableName, injected);

    const cleared = breakingChangeFields.clearedFields.get(plan.tableName) ?? new Set<string>();
    cleared.add(plan.fieldName);
    breakingChangeFields.clearedFields.set(plan.tableName, cleared);
  }

  const tables = [...Object.values(snapshot.tables), ...breakingChangeFields.renamedTypes.values()];
  if (tables.length === 0) {
    return generateEmptyDbTypes(snapshot.namespace);
  }

  // Track which utility types are used
  const usedUtilityTypes = new Set<"Timestamp" | "Serial">();

  // Generate type definitions
  const typeDefinitions: string[] = [];
  for (const type of tables) {
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
    `import { ${imports.join(", ")} } from "@tailor-platform/sdk/kysely";`,
    'import type { Env } from "@tailor-platform/sdk";',
    "",
    ...utilityTypeDeclarations,
    "",
    "export interface Database {",
    ...typeDefinitions,
    "}",
    "",
    "export type Transaction = KyselyTransaction<Database>;",
    "",
    "/** Context passed as the second argument to the migration's `main` function. */",
    "export type MigrationContext = {",
    "  env: keyof Env extends never ? Record<string, string | number | boolean> : Env;",
    "};",
  ];

  return lines.join("\n") + "\n";
}

/**
 * Generate an empty db.ts file for migrations with no tables
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
      'import { type Transaction as KyselyTransaction } from "@tailor-platform/sdk/kysely";',
      'import type { Env } from "@tailor-platform/sdk";',
      "",
      "// eslint-disable-next-line @typescript-eslint/no-empty-object-type",
      "export interface Database {}",
      "",
      "export type Transaction = KyselyTransaction<Database>;",
      "",
      "/** Context passed as the second argument to the migration's `main` function. */",
      "export type MigrationContext = {",
      "  env: keyof Env extends never ? Record<string, string | number | boolean> : Env;",
      "};",
    ].join("\n") + "\n"
  );
}

/**
 * Generate table type definition from a snapshot type
 * @param {TailorDBSnapshotType} type - Table snapshot
 * @param {BreakingChangeFieldInfo} breakingChangeFields - Breaking change field info
 * @returns {{ typeDef: string; usedTimestamp: boolean; usedColumnType: boolean }} Generated type and utility type usage
 */
function generateTableType(
  type: TailorDBSnapshotType,
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

  // Get fields that are changing from optional to required for this table
  const optionalToRequiredFields =
    breakingChangeFields.optionalToRequired.get(type.name) || new Set();

  // Get newly added required fields for this table
  const addedRequiredFields = breakingChangeFields.addedRequiredFields.get(type.name) || new Map();

  // Get enum value changes for this type
  const enumValueChangesForType = breakingChangeFields.enumValueChanges.get(type.name) || new Map();

  // Fields a conversion script clears once it has carried the value across
  const clearedFieldsForType =
    breakingChangeFields.clearedFields.get(type.name) ?? new Set<string>();

  for (const [fieldName, fieldConfig] of Object.entries(type.fields)) {
    if (fieldName === "id") continue;

    const isOptionalToRequired = optionalToRequiredFields.has(fieldName);
    const enumValueChange = enumValueChangesForType.get(fieldName);
    const result = generateFieldType(fieldConfig, isOptionalToRequired, enumValueChange);
    // A conversion script clears its source field, and Kysely reads the third
    // ColumnType slot for updates.
    const clearable = clearedFieldsForType.has(fieldName);
    const emitted = clearable ? generateClearableFieldType(fieldConfig) : result;
    fieldLines.push(`    ${fieldName}: ${emitted.type};`);
    usedTimestamp = usedTimestamp || emitted.usedTimestamp;
    usedColumnType = usedColumnType || result.usedColumnType || clearable;
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

  // Add rename target fields, which do not exist in the pre-migration snapshot.
  // A required target reads as nullable until the copy script fills it in
  // (same shape as optional→required); an optional target is plainly nullable.
  const renamedFieldsForType = breakingChangeFields.renamedFields.get(type.name) || new Map();
  for (const [fieldName, fieldConfig] of renamedFieldsForType) {
    const result = generateFieldType(fieldConfig, fieldConfig.required, undefined);
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
  if (fieldType === "number") {
    return { type: "number", usedTimestamp: false };
  }
  if (fieldType === "enum" || fieldType === "nested") {
    return { type: "string", usedTimestamp: false };
  }
  const type = mapFieldTypeToColumnType(fieldType);
  return { type, usedTimestamp: type === "Timestamp" };
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
 * Column type for a field the migration script both reads and clears.
 *
 * Kysely takes the select, insert, and update types from the three slots in
 * turn, so the update slot has to accept the null the script writes.
 * @param config - Field configuration in the pre-migration snapshot
 * @returns {string} Generated column type
 */
function generateClearableFieldType(config: SnapshotFieldConfig): {
  type: string;
  usedTimestamp: boolean;
} {
  const { type } = mapToTsType(config.type);
  // A ColumnType cannot nest, so a timestamp contributes its own select and
  // write types to the slots rather than the Timestamp alias.
  if (type === "Timestamp") {
    const select = config.array ? "Date[]" : "Date";
    const write = config.array ? "(Date | string)[]" : "Date | string";
    return {
      type: `ColumnType<${select} | null, ${write} | null, ${write} | null>`,
      usedTimestamp: false,
    };
  }
  const base = config.array ? `${type}[]` : type;
  return {
    type: `ColumnType<${base} | null, ${base} | null, ${base} | null>`,
    usedTimestamp: false,
  };
}

function generateOptionalToRequiredDateColumnType(config: SnapshotFieldConfig): string | null {
  if (config.type !== "date" && config.type !== "datetime") return null;

  if (config.array) {
    return "ColumnType<Date[] | null, (Date | string)[], (Date | string)[]>";
  }

  return "ColumnType<Date | null, Date | string, Date | string>";
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
    const enumValues = config.allowedValues?.map((v) => v.value) ?? [];
    baseType = enumValues.length > 0 ? formatEnumUnion(enumValues) : "string";
  } else {
    const mapped = mapToTsType(config.type);
    baseType = mapped.type;
    usedTimestamp = mapped.usedTimestamp;
  }

  if (isOptionalToRequired) {
    const dateColumnType = generateOptionalToRequiredDateColumnType(config);
    if (dateColumnType) {
      return {
        type: dateColumnType,
        usedTimestamp: false,
        usedColumnType: true,
      };
    }
  }

  // Apply array modifier. Kysely only unwraps a ColumnType at the top level of a
  // table property, so a timestamp array spells its slots out instead of nesting
  // the Timestamp alias.
  let type = baseType;
  if (config.array) {
    if (baseType === "Timestamp") {
      const nullable = config.required ? "" : " | null";
      return {
        type: `ColumnType<Date[]${nullable}, (Date | string)[]${nullable}, (Date | string)[]${nullable}>`,
        usedTimestamp: false,
        usedColumnType: true,
      };
    }
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
 * @param expandPlans - Field changes carried through temporary fields
 * @returns {Promise<string>} Path to the written file
 */
export async function writeDbTypesFile(
  snapshot: SchemaSnapshot,
  migrationsDir: string,
  migrationNumber: number,
  diff?: MigrationDiff,
  expandPlans: readonly ExpandContractPlan[] = [],
): Promise<string> {
  const content = generateDbTypesFromSnapshot(snapshot, diff, expandPlans);
  const filePath = getMigrationFilePath(migrationsDir, migrationNumber, "db");
  await fs.writeFile(filePath, content);
  return filePath;
}
