/**
 * The changes to a field's contract that rows stored under the previous
 * schema can break. Each rule says, in one place, why the change is breaking,
 * how the Pre-phase loosens the field while `migrate.ts` runs, and which
 * statement the generated script runs for it. Rules are listed in the order a
 * field's breaking changes are reported and its statements run: references
 * are repaired before the fixups that rewrite those rows.
 */

import { formatForeignKeyTarget } from "./diff-calculator";
import { supportsInPlaceFieldTypeChange } from "./field-type-change";
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
  required?: boolean;
  unique?: boolean;
  foreignKey?: boolean;
  foreignKeyType?: string;
  foreignKeyField?: string;
  allowedValues?: { value?: string; description?: string }[];
  fields?: Record<string, PreMigrationField>;
}

/** A field or nested member the migration changes; `before` is undefined when it adds one. */
export interface FieldRuleInput {
  before: SnapshotFieldConfig | undefined;
  after: SnapshotFieldConfig;
  nestedMember: boolean;
  /** Confirmed table renames (old name → new name). */
  typeRenameTargets: ReadonlyMap<string, string> | undefined;
}

type AddedField = FieldRuleInput & { before: undefined };
type ModifiedField = FieldRuleInput & { before: SnapshotFieldConfig };
type ScaffoldedChange = FieldAddedChange | FieldModifiedChange | FieldTypeModifiedChange;

interface Breakage {
  reason: string;
  /** `migration generate` rejects the change and shows the three-step hint. */
  unsupported?: true;
}

interface Relaxation<I> {
  /** When to relax, if not exactly when the rule breaks. */
  when?: (input: I) => boolean;
  apply: (field: PreMigrationField, input: I) => void;
}

interface Rule<I, C> {
  breaks: (input: I) => Breakage | undefined;
  /** null when the Pre-phase sends the target contract, or keeps the whole previous field (a type change). */
  relax: Relaxation<I> | null;
  /** The statement `migrate.ts` runs for a top-level field the rule breaks; null when there is none. */
  scaffold: ((change: C) => string) | null;
}

type FieldChangeRule =
  | ({ on: "added" } & Rule<AddedField, FieldAddedChange>)
  | ({ on: "modified" } & Rule<ModifiedField, FieldModifiedChange | FieldTypeModifiedChange>);

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

/**
 * A retarget that follows a confirmed table rename and keeps the key keeps its
 * references valid: the copy preserves record ids.
 * @param input - The changed field
 * @returns True if stored references may point at no record of the new target
 */
function isBreakingForeignKeyRetarget(input: ModifiedField): boolean {
  const { before, after, typeRenameTargets } = input;
  return (
    changesForeignKeyTarget(before, after) &&
    (before.foreignKeyField !== after.foreignKeyField ||
      typeRenameTargets?.get(before.foreignKeyType ?? "") !== after.foreignKeyType)
  );
}

function removedEnumValues(before: SnapshotFieldConfig, after: SnapshotFieldConfig): string[] {
  if (before.type !== "enum" || after.type !== "enum") return [];
  const afterValues = new Set((after.allowedValues ?? []).map((v) => v.value));
  return (before.allowedValues ?? []).map((v) => v.value).filter((v) => !afterValues.has(v));
}

function withholdForeignKey(field: PreMigrationField): void {
  delete field.foreignKey;
  delete field.foreignKeyType;
  delete field.foreignKeyField;
}

const unsupportedWhen = (unsupported: boolean) =>
  unsupported ? { unsupported: true as const } : {};

const FIELD_CHANGE_RULES: readonly FieldChangeRule[] = [
  {
    on: "modified",
    breaks: ({ before, after, nestedMember }) =>
      before.type === after.type
        ? undefined
        : {
            reason: `Field type changed from ${before.type} to ${after.type}`,
            ...unsupportedWhen(nestedMember || !supportsInPlaceFieldTypeChange(before, after)),
          },
    relax: null,
    scaffold: (change) => generateFieldTypeChangeScript(change),
  },
  {
    on: "modified",
    breaks: ({ before, after }) =>
      (before.array ?? false) === (after.array ?? false)
        ? undefined
        : {
            reason: before.array
              ? "Field changed from array to single value"
              : "Field changed from single value to array",
            unsupported: true,
          },
    relax: null,
    scaffold: null,
  },
  {
    on: "modified",
    breaks: (input) =>
      isBreakingForeignKeyRetarget(input)
        ? {
            reason: `Foreign key target changed from ${formatForeignKeyTarget(input.before)} to ${formatForeignKeyTarget(input.after)}`,
            ...unsupportedWhen(input.nestedMember),
          }
        : undefined,
    relax: {
      when: ({ before, after }) => changesForeignKeyTarget(before, after),
      apply: withholdForeignKey,
    },
    scaffold: (change) =>
      generateUnmatchedReferenceScript(
        change,
        `Migrate ${change.fieldName} references from ${formatForeignKeyTarget(change.before)} to ${formatForeignKeyTarget(change.after)}`,
      ),
  },
  {
    on: "modified",
    breaks: ({ before, after, nestedMember }) =>
      !nestedMember && addsForeignKey(before, after)
        ? { reason: `Foreign key to ${after.foreignKeyType} added to field` }
        : undefined,
    relax: { apply: withholdForeignKey },
    scaffold: (change) =>
      generateUnmatchedReferenceScript(
        change,
        `Check existing ${change.fieldName} values against the new foreign key to ${change.after.foreignKeyType}`,
      ),
  },
  {
    on: "added",
    breaks: ({ after }) => (after.required ? { reason: "Required field added" } : undefined),
    relax: {
      apply: (field) => {
        field.required = false;
      },
    },
    scaffold: (change) => generatePopulateScript(change),
  },
  {
    on: "modified",
    breaks: ({ before, after }) =>
      !before.required && after.required
        ? { reason: "Field changed from optional to required" }
        : undefined,
    relax: {
      apply: (field) => {
        field.required = false;
      },
    },
    scaffold: (change) => generateFillNullScript(change),
  },
  {
    on: "modified",
    breaks: ({ before, after, nestedMember }) =>
      before.type === "decimal" && after.type === "decimal" && before.scale !== after.scale
        ? {
            reason: `Decimal scale changed from ${before.scale} to ${after.scale}`,
            ...unsupportedWhen(nestedMember),
          }
        : undefined,
    relax: null,
    scaffold: (change) => generateDecimalScaleChangeScript(change),
  },
  {
    on: "modified",
    breaks: ({ before, after }) =>
      !(before.unique ?? false) && (after.unique ?? false)
        ? { reason: "Unique constraint added to field" }
        : undefined,
    relax: {
      apply: (field) => {
        field.unique = false;
      },
    },
    scaffold: (change) =>
      generateUniqueDedupeScript(
        change.tableName,
        change.fieldName,
        change.kind === "field_type_modified" ? "throw" : "suffix",
      ),
  },
  {
    on: "modified",
    breaks: ({ before, after }) => {
      const removed = removedEnumValues(before, after);
      return removed.length > 0
        ? { reason: `Enum values removed: ${removed.join(", ")}` }
        : undefined;
    },
    relax: {
      // Snapshots omit allowedValues when an enum has no values left.
      apply: (field, { before, after }) => {
        const values = new Map<string, string>();
        for (const v of before.allowedValues ?? []) values.set(v.value, v.description ?? "");
        for (const v of after.allowedValues ?? []) {
          if (!values.has(v.value)) values.set(v.value, v.description ?? "");
        }
        field.allowedValues = Array.from(values, ([value, description]) => ({
          value,
          description,
        }));
      },
    },
    scaffold: (change) => generateEnumValueMigrationScript(change),
  },
];

interface BoundRule {
  breakage: Breakage | undefined;
  relax: ((field: PreMigrationField) => void) | undefined;
}

function bind<I extends FieldRuleInput>(rule: Rule<I, never>, input: I): BoundRule {
  const breakage = rule.breaks(input);
  const { relax } = rule;
  const relaxes = relax && (relax.when ? relax.when(input) : breakage !== undefined);
  return {
    breakage,
    relax: relaxes ? (field) => relax.apply(field, input) : undefined,
  };
}

function bindRules(input: FieldRuleInput): BoundRule[] {
  const { before } = input;
  return FIELD_CHANGE_RULES.flatMap((rule) => {
    if (rule.on === "added") return before === undefined ? [bind(rule, { ...input, before })] : [];
    return before === undefined ? [] : [bind(rule, { ...input, before })];
  });
}

/** Identifies the changed field in a breaking change report. */
interface BreakingFieldLocation {
  tableName: string;
  /** Field name, dotted for a nested member. */
  fieldName: string;
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
  return bindRules(input).flatMap(({ breakage }) =>
    breakage
      ? [
          {
            ...location,
            reason: breakage.reason,
            ...(breakage.unsupported && { unsupported: true, showThreeStepHint: true }),
          },
        ]
      : [],
  );
}

/**
 * Loosen a Pre-phase field (mutated in place) so `migrate.ts` can run against
 * the rows stored under its previous contract.
 * @param field - Pre-phase field, top-level or nested member
 * @param input - The changed field
 */
export function relaxFieldForPreMigration(field: PreMigrationField, input: FieldRuleInput): void {
  for (const { relax } of bindRules(input)) relax?.(field);
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
  const base = { after: change.after, nestedMember: false, typeRenameTargets };
  return FIELD_CHANGE_RULES.flatMap((rule) => {
    if (rule.on === "added") {
      if (change.kind !== "field_added") return [];
      const input = { ...base, before: undefined };
      return rule.scaffold && rule.breaks(input) ? [rule.scaffold(change)] : [];
    }
    if (change.kind === "field_added") return [];
    const input = { ...base, before: change.before };
    return rule.scaffold && rule.breaks(input) ? [rule.scaffold(change)] : [];
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
