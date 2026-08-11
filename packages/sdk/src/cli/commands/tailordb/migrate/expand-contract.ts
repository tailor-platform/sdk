/**
 * Planning for field type changes that move values through a temporary field.
 *
 * A change that cannot be applied in place is split into two migrations: the
 * first adds a temporary field and converts values into it, the second renames
 * that field back over the original.
 */

import { supportsExpandContractFieldChange } from "./field-type-change";
import type { BreakingChangeInfo, MigrationDiff } from "./diff-calculator";
import type { SchemaSnapshot, SnapshotFieldConfig } from "./snapshot-types";

/** Longest field name the platform accepts. */
const MAX_FIELD_NAME_LENGTH = 63;

const TEMP_FIELD_SUFFIX = "Migrate";

/** One field type change to carry through a temporary field. */
export interface ExpandContractPlan {
  typeName: string;
  fieldName: string;
  /** Field that holds converted values until the contract migration. */
  tempFieldName: string;
  before: SnapshotFieldConfig;
  after: SnapshotFieldConfig;
}

/** Changes to automate, and the ones that must still be rejected. */
export interface ExpandContractPlanning {
  plans: ExpandContractPlan[];
  blocked: BreakingChangeInfo[];
}

/**
 * Key identifying a field across snapshots and user-supplied options.
 * @param typeName - Name of the type holding the field
 * @param fieldName - Name of the field
 * @returns Key in `Type.field` form
 */
export function fieldKey(typeName: string, fieldName: string): string {
  return `${typeName}.${fieldName}`;
}

/**
 * Derive the temporary field name to carry a field's converted values.
 *
 * Field names cannot hold an underscore, so the suffix is camelCase and a
 * collision is resolved by an ordinal rather than a separator.
 * @param fieldName - Field being converted
 * @param taken - Field names already in use for the same type
 * @returns Unused temporary field name
 * @throws {Error} When no candidate fits within the platform's length limit
 */
export function buildTempFieldName(fieldName: string, taken: ReadonlySet<string>): string {
  const base = `${fieldName}${TEMP_FIELD_SUFFIX}`;
  for (let ordinal = 1; ordinal <= taken.size + 1; ordinal++) {
    const candidate = ordinal === 1 ? base : `${base}${ordinal}`;
    if (candidate.length > MAX_FIELD_NAME_LENGTH) break;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(
    `Cannot derive a temporary field name for "${fieldName}": every candidate is taken or exceeds ${MAX_FIELD_NAME_LENGTH} characters.`,
  );
}

/** Inputs for {@link planExpandContract}. */
export interface PlanExpandContractOptions {
  previous: SchemaSnapshot;
  current: SchemaSnapshot;
  diff: MigrationDiff;
  /** `Type.field` keys the user approved for automation. */
  confirmed: ReadonlySet<string>;
}

/**
 * Split unsupported field type changes into the ones a migration pair can carry
 * and the ones that must still fail.
 * @param options - Snapshots, diff, and the changes the user approved
 * @returns Plans to generate and breaking changes to reject
 */
export function planExpandContract(options: PlanExpandContractOptions): ExpandContractPlanning {
  const { previous, current, diff, confirmed } = options;
  const plans: ExpandContractPlan[] = [];
  const planned = new Set<string>();

  for (const change of diff.changes) {
    if (change.kind !== "field_type_modified") continue;
    const key = fieldKey(change.typeName, change.fieldName);
    if (!confirmed.has(key)) continue;
    if (!supportsExpandContractFieldChange(change.before, change.after)) continue;

    const taken = new Set([
      ...Object.keys(previous.types[change.typeName]?.fields ?? {}),
      ...Object.keys(current.types[change.typeName]?.fields ?? {}),
      ...plans
        .filter((plan) => plan.typeName === change.typeName)
        .map((plan) => plan.tempFieldName),
    ]);
    plans.push({
      typeName: change.typeName,
      fieldName: change.fieldName,
      tempFieldName: buildTempFieldName(change.fieldName, taken),
      before: change.before,
      after: change.after,
    });
    planned.add(key);
  }

  const blocked = diff.breakingChanges.filter(
    (change) =>
      change.unsupported &&
      !(change.fieldName && planned.has(fieldKey(change.typeName, change.fieldName))),
  );

  return { plans, blocked };
}
