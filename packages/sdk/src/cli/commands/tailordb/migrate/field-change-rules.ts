/**
 * How the field change rules of `field-change-model.ts` are reported, applied to a
 * Pre-phase field, and scaffolded into `migrate.ts` statements. Rules are listed in
 * the order a field's breaking changes are reported and its statements run:
 * references are repaired before the fixups that rewrite those rows.
 */

import { formatForeignKeyTarget } from "./diff-calculator";
import {
  evaluateFieldChange,
  FIELD_CHANGE_RULE_IDS,
  type FieldChangeInput,
  type FieldChangeOutcome,
  type FieldChangeRuleId,
} from "./field-change-model";
import { DEFAULT_DECIMAL_SCALE } from "./snapshot-normalization";
import type {
  BreakingChangeInfo,
  FieldAddedChange,
  FieldModifiedChange,
  FieldTypeModifiedChange,
} from "./diff-calculator";
import type { SnapshotFieldConfig } from "./snapshot-types";

/** The properties the Pre-phase relaxes, shared by the proto and snapshot field shapes. */
export interface PreMigrationField {
  required?: boolean | undefined;
  unique?: boolean | undefined;
  foreignKey?: boolean | undefined;
  foreignKeyType?: string | undefined;
  foreignKeyField?: string | undefined;
  allowedValues?: { value?: string | undefined; description?: string | undefined }[] | undefined;
  fields?: Record<string, PreMigrationField> | undefined;
}

/** A field or nested member the migration changes; `before` is undefined when it adds one. */
export type FieldRuleInput = FieldChangeInput;

type ModifiedField = FieldRuleInput & { before: SnapshotFieldConfig };
type ScaffoldedChange = FieldAddedChange | FieldModifiedChange | FieldTypeModifiedChange;

/**
 * Whether a field that had no foreign key gains one.
 * @param before - Field configuration before the change
 * @param after - Field configuration after the change
 * @returns True if the change adds a foreign key
 */
export function addsForeignKey(before: SnapshotFieldConfig, after: SnapshotFieldConfig): boolean {
  return !before.foreignKeyType && Boolean(after.foreignKeyType);
}

/**
 * Whether a field's foreign key moves to another table or key.
 * @param before - Field configuration before the change
 * @param after - Field configuration after the change
 * @returns True if the change moves an existing foreign key
 */
export function changesForeignKeyTarget(
  before: SnapshotFieldConfig,
  after: SnapshotFieldConfig,
): boolean {
  return (
    before.foreignKeyType !== undefined &&
    after.foreignKeyType !== undefined &&
    (before.foreignKeyType !== after.foreignKeyType ||
      before.foreignKeyField !== after.foreignKeyField)
  );
}

function removedEnumValues(before: SnapshotFieldConfig, after: SnapshotFieldConfig): string[] {
  if (before.type !== "enum" || after.type !== "enum") return [];
  const afterValues = new Set((after.allowedValues ?? []).map((v) => v.value));
  return (before.allowedValues ?? []).map((v) => v.value).filter((v) => !afterValues.has(v));
}

type RulePresentation = {
  /** How a breaking change is reported. */
  reason: (input: FieldRuleInput) => string;
  /** The statement `migrate.ts` runs for a top-level field the rule breaks; null when there is none. */
  scaffold: ((change: ScaffoldedChange) => string) | null;
};

type ModifiedChange = FieldModifiedChange | FieldTypeModifiedChange;

const asModified = (change: ScaffoldedChange) => change as ModifiedChange;
const modified = (input: FieldRuleInput) => input as ModifiedField;

const RULE_PRESENTATION = {
  typeChanged: {
    reason: (input) =>
      `Field type changed from ${modified(input).before.type} to ${input.after.type}`,
    scaffold: (change) => generateFieldTypeChangeScript(asModified(change)),
  },
  arrayChanged: {
    reason: (input) =>
      modified(input).before.array
        ? "Field changed from array to single value"
        : "Field changed from single value to array",
    scaffold: null,
  },
  foreignKeyRetargeted: {
    reason: (input) =>
      `Foreign key target changed from ${formatForeignKeyTarget(modified(input).before)} to ${formatForeignKeyTarget(input.after)}`,
    scaffold: (change) =>
      generateUnmatchedReferenceScript(
        asModified(change),
        `Migrate ${change.fieldName} references from ${formatForeignKeyTarget(asModified(change).before)} to ${formatForeignKeyTarget(change.after)}`,
      ),
  },
  foreignKeyAdded: {
    reason: (input) => `Foreign key to ${input.after.foreignKeyType} added to field`,
    scaffold: (change) =>
      generateUnmatchedReferenceScript(
        asModified(change),
        `Check existing ${change.fieldName} values against the new foreign key to ${change.after.foreignKeyType}`,
      ),
  },
  requiredFieldAdded: {
    reason: () => "Required field added",
    scaffold: (change) => generatePopulateScript(change as FieldAddedChange),
  },
  madeRequired: {
    reason: () => "Field changed from optional to required",
    scaffold: (change) => generateFillNullScript(asModified(change)),
  },
  decimalScaleChanged: {
    reason: (input) =>
      `Decimal scale changed from ${modified(input).before.scale} to ${input.after.scale}`,
    scaffold: (change) => generateDecimalScaleChangeScript(asModified(change)),
  },
  uniqueAdded: {
    reason: () => "Unique constraint added to field",
    scaffold: (change) =>
      generateUniqueDedupeScript(
        change.tableName,
        change.fieldName,
        change.kind === "field_type_modified" ? "throw" : "suffix",
      ),
  },
  enumValuesRemoved: {
    reason: (input) =>
      `Enum values removed: ${removedEnumValues(modified(input).before, input.after).join(", ")}`,
    scaffold: (change) => generateEnumValueMigrationScript(asModified(change)),
  },
} satisfies Record<FieldChangeRuleId, RulePresentation>;

function withholdForeignKey(field: PreMigrationField): void {
  delete field.foreignKey;
  delete field.foreignKeyType;
  delete field.foreignKeyField;
}

function widenEnumValues(field: PreMigrationField, input: ModifiedField): void {
  // Snapshots omit allowedValues when an enum has no values left.
  const values = new Map<string, string>();
  for (const v of input.before.allowedValues ?? []) values.set(v.value, v.description ?? "");
  for (const v of input.after.allowedValues ?? []) {
    if (!values.has(v.value)) values.set(v.value, v.description ?? "");
  }
  field.allowedValues = Array.from(values, ([value, description]) => ({ value, description }));
}

/** Identifies the changed field in a breaking change report. */
interface BreakingFieldLocation {
  tableName: string;
  /** Field name, dotted for a nested member. */
  fieldName: string;
}

function brokenRules(outcome: FieldChangeOutcome): FieldChangeRuleId[] {
  return FIELD_CHANGE_RULE_IDS.filter((id) => outcome.breaks[id] !== "none");
}

/**
 * The breaking changes of one field or nested member, in rule order.
 * @param location - Table and field the change is reported for
 * @param input - The changed field
 * @returns Breaking change information
 */
export function collectBreakingFieldChanges(
  location: BreakingFieldLocation,
  input: FieldRuleInput,
): BreakingChangeInfo[] {
  const outcome = evaluateFieldChange(input);
  return brokenRules(outcome).map((id) => ({
    ...location,
    reason: RULE_PRESENTATION[id].reason(input),
    ...(outcome.breaks[id] === "unsupported" && { unsupported: true, showThreeStepHint: true }),
  }));
}

/**
 * Loosen a Pre-phase field (mutated in place) so `migrate.ts` can run against
 * the rows stored under its previous contract.
 * @param field - Pre-phase field, top-level or nested member
 * @param input - The changed field
 */
export function relaxFieldForPreMigration(field: PreMigrationField, input: FieldRuleInput): void {
  const { relax } = evaluateFieldChange(input);
  if (relax.withoutForeignKey) withholdForeignKey(field);
  if (relax.optional) field.required = false;
  if (relax.notUnique) field.unique = false;
  if (relax.previousEnumValues) widenEnumValues(field, modified(input));
}

/**
 * The statements `migrate.ts` runs for the rules a top-level field change breaks, in rule order.
 * @param change - The field change
 * @param typeRenameTargets - Confirmed table renames (old name → new name)
 * @returns Statements, empty when no rule needs one
 */
export function scaffoldFieldChange(
  change: ScaffoldedChange,
  typeRenameTargets: ReadonlyMap<string, string>,
): string[] {
  const outcome = evaluateFieldChange({
    before: change.kind === "field_added" ? undefined : change.before,
    after: change.after,
    nestedMember: false,
    typeRenameTargets,
  });
  return brokenRules(outcome).flatMap((id) => {
    const { scaffold } = RULE_PRESENTATION[id];
    return scaffold ? [scaffold(change)] : [];
  });
}

function generatePopulateScript(change: FieldAddedChange): string {
  return `  // Populate ${change.fieldName} for existing ${change.tableName} records
  await trx
    .updateTable("${change.tableName}")
    .set({
      ${change.fieldName}: TODO("set the value ${change.tableName}.${change.fieldName} takes in existing records"),
    })
    .execute();`;
}

function generateFillNullScript(change: FieldModifiedChange | FieldTypeModifiedChange): string {
  return `  // Set ${change.fieldName} for ${change.tableName} records where it is null
  await trx
    .updateTable("${change.tableName}")
    .set({
      ${change.fieldName}: TODO("set the value ${change.tableName}.${change.fieldName} takes where it is null"),
    })
    .where("${change.fieldName}", "is", null)
    .execute();`;
}

function generateFieldTypeChangeScript(
  change: FieldModifiedChange | FieldTypeModifiedChange,
): string {
  return `  // Normalize ${change.tableName}.${change.fieldName} from ${change.before.type} to ${change.after.type} while the previous type is still active
  {
    let lastId: string | undefined;
    while (true) {
      let query = trx
        .selectFrom("${change.tableName}")
        .select(["id", "${change.fieldName}"])
        .where("${change.fieldName}", "is not", null)
        .orderBy("id", "asc")
        .limit(100);
      if (lastId) {
        query = query.where("id", ">", lastId);
      }
      const rows = await query.execute();
      if (rows.length === 0) break;

      for (const row of rows) {
        const sourceValue = row.${change.fieldName};
        if (sourceValue === null) continue;
        const normalizedValue = TODO("normalize ${change.tableName}.${change.fieldName} to a value the active ${change.before.type} type accepts and the ${change.after.type} type can cast");
        if (Object.is(normalizedValue, sourceValue)) continue;
        await trx
          .updateTable("${change.tableName}")
          .set({ [${JSON.stringify(change.fieldName)}]: normalizedValue })
          .where("id", "=", row.id)
          .execute();
      }
      lastId = rows[rows.length - 1]!.id;
    }
  }`;
}

function generateUnmatchedReferenceScript(
  change: FieldModifiedChange | FieldTypeModifiedChange,
  heading: string,
): string {
  const { tableName, fieldName, after } = change;
  const target = after.foreignKeyType;
  if (after.array) {
    const message = `resolve the ${tableName}.${fieldName} elements that point at no ${target} record`;
    return `  // ${heading}
  void TODO(${JSON.stringify(message)});`;
  }
  // Aliased so that a relation to its own table can join it a second time.
  const alias = `${tableName}Target`;
  const key = after.foreignKeyField ?? "id";
  return `  // ${heading}
  // Find records that don't have a valid reference in ${target}
  {
    const orphanedRecords = await trx
      .selectFrom("${tableName}")
      .leftJoin("${target} as ${alias}", "${tableName}.${fieldName}", "${alias}.${key}")
      .select(["${tableName}.id", "${tableName}.${fieldName}"])
      .where("${alias}.${key}", "is", null)
      .where("${tableName}.${fieldName}", "is not", null)
      .execute();
    for (const record of orphanedRecords) {
      await trx
        .updateTable("${tableName}")
        .set({ ${fieldName}: TODO("set the ${target} reference for ${tableName}.${fieldName}") })
        .where("id", "=", record.id)
        .execute();
    }
  }`;
}

function generateDecimalScaleChangeScript(
  change: FieldModifiedChange | FieldTypeModifiedChange,
): string {
  const { before, after } = change;
  const valueExpression =
    !before.required && after.required ? `row.${change.fieldName}!` : `row.${change.fieldName}`;
  const beforeScale = before.scale ?? DEFAULT_DECIMAL_SCALE;
  const afterScale = after.scale ?? DEFAULT_DECIMAL_SCALE;
  const roundingWarning =
    afterScale < beforeScale
      ? `
  // WARNING: Values that exceed the new scale may be rounded half-up, so
  // review the resulting precision before deploying.`
      : "";

  return `  // Re-save existing ${change.tableName} rows so ${change.fieldName} is stored under the new scale.
  // This is a workaround for a platform-side gap where rows written under the
  // previous scale could fail on later updates until re-saved. Keep it unless
  // your platform is confirmed to handle stored values across scale changes.${roundingWarning}
  {
    let lastId: string | undefined;
    while (true) {
      let query = trx
        .selectFrom("${change.tableName}")
        .select(["id", "${change.fieldName}"])
        .where("${change.fieldName}", "is not", null)
        .orderBy("id", "asc")
        .limit(100);
      if (lastId) {
        query = query.where("id", ">", lastId);
      }
      const rows = await query.execute();
      if (rows.length === 0) break;

      for (const row of rows) {
        await trx
          .updateTable("${change.tableName}")
          .set({ ${change.fieldName}: ${valueExpression} })
          .where("id", "=", row.id)
          .where("${change.fieldName}", "=", ${valueExpression})
          .execute();
      }
      lastId = rows[rows.length - 1]!.id;
    }
  }`;
}

/**
 * The statement that resolves duplicate values of a field before its unique constraint applies.
 * @param tableName - Table of the field
 * @param fieldName - Field gaining the unique constraint
 * @param resolution - Give the duplicates new values, or stop at a TODO when they cannot be rewritten
 * @returns The statement
 */
export function generateUniqueDedupeScript(
  tableName: string,
  fieldName: string,
  resolution: "suffix" | "throw",
): string {
  const duplicateResolution =
    resolution === "throw"
      ? `      if (records.length > 1) {
        TODO("resolve the duplicate ${tableName}.${fieldName} values before the unique constraint is added");
      }`
      : `      // Keep the first record and give the others a new value
      for (let i = 1; i < records.length; i++) {
        await trx
          .updateTable("${tableName}")
          .set({ ${fieldName}: TODO("set a unique ${tableName}.${fieldName} value for the duplicates") })
          .where("id", "=", records[i].id)
          .execute();
      }`;

  return `  // Ensure ${fieldName} values are unique before adding constraint
  {
    const duplicates = await trx
      .selectFrom("${tableName}")
      .select(["${fieldName}"])
      .groupBy("${fieldName}")
      .having((eb) => eb.fn.count("id"), ">", 1)
      .execute();
    for (const dup of duplicates) {
      // Load every record in this duplicate group before resolving it
      const records = await trx
        .selectFrom("${tableName}")
        .select(["id", "${fieldName}"])
        .where("${fieldName}", "=", dup.${fieldName})
        .execute();
${duplicateResolution}
    }
  }`;
}

function generateEnumValueMigrationScript(
  change: FieldModifiedChange | FieldTypeModifiedChange,
): string {
  const { before, after } = change;
  const removedValues = removedEnumValues(before, after);
  const afterValues = (after.allowedValues ?? []).map((v) => v.value);
  const choices = afterValues.length > 0 ? ` (${afterValues.join(", ")})` : "";
  const replacement = `TODO(${JSON.stringify(`choose the ${change.tableName}.${change.fieldName} value that replaces ${removedValues.join(", ")}${choices}`)})`;
  if (!before.array) {
    return `  // Migrate records with removed enum values: ${removedValues.join(", ")}
  await trx
    .updateTable("${change.tableName}")
    .set({ ${change.fieldName}: ${replacement} })
    .where("${change.fieldName}", "in", [${removedValues.map((v) => JSON.stringify(v)).join(", ")}])
    .execute();`;
  }
  const table = JSON.stringify(change.tableName);
  const column = JSON.stringify(change.fieldName);
  return `  // Migrate array elements with removed enum values: ${removedValues.join(", ")}
  {
    let lastId: string | undefined;
    while (true) {
      let query = trx
        .selectFrom(${table})
        .select(["id", ${column}])
        .orderBy("id", "asc")
        .limit(100);
      if (lastId) {
        query = query.where("id", ">", lastId);
      }
      const rows = await query.execute();
      if (rows.length === 0) break;

      for (const row of rows) {
        const values = row[${column}];
        if (values === null) continue;
        let changed = false;
        const converted = values.map((value) => {
          switch (value) {
${removedValues.map((value) => `            case ${JSON.stringify(value)}:`).join("\n")}
              changed = true;
              return ${replacement};
            default:
              return value;
          }
        });
        if (!changed) continue;
        await trx
          .updateTable(${table})
          .set({ [${column}]: converted })
          .where("id", "=", row.id)
          .execute();
      }
      lastId = rows[rows.length - 1]!.id;
    }
  }`;
}
