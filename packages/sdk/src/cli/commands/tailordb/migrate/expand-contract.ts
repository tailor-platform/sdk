/**
 * Planning for field type changes that move values through a temporary field.
 *
 * A change that cannot be applied in place is split into two migrations: the
 * first adds a temporary field and converts values into it, the second renames
 * that field back over the original.
 */

import { getExpandContractFieldChangeEligibility } from "./field-type-change";
import type { BreakingChangeInfo, MigrationDiff } from "./diff-calculator";
import type { SchemaSnapshot, SnapshotFieldConfig, TailorDBSnapshotType } from "./snapshot-types";

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
 * Whether a field type change can be carried by a generated migration pair.
 *
 * The single answer behind the prompt, the flag hint, and planning, so a run
 * cannot recommend a conversion it would then reject.
 * @param options - Snapshots and the field to test
 * @returns Whether the conversion can be generated
 */
export function canConvertField(options: CanConvertFieldOptions): boolean {
  return getExpandContractEligibility(options).eligible;
}

/** Result of checking whether a field can use expand-contract. */
export type ExpandContractEligibility = { eligible: true } | { eligible: false; reason: string };

/**
 * Explain whether a field can be carried by a generated migration pair.
 * @param options - Snapshots and the field to test
 * @returns Eligibility and, when ineligible, the reason
 */
export function getExpandContractEligibility(
  options: CanConvertFieldOptions,
): ExpandContractEligibility {
  const { previous, current, typeName, fieldName } = options;
  const before = previous.types[typeName]?.fields[fieldName];
  const after = current.types[typeName]?.fields[fieldName];
  if (!before || !after) {
    return { eligible: false, reason: "the field does not exist in both schemas" };
  }
  const fieldEligibility = getExpandContractFieldChangeEligibility(before, after);
  if (!fieldEligibility.eligible) return fieldEligibility;
  if (
    isFieldReferenced(previous.types[typeName], fieldName) ||
    isFieldReferenced(current.types[typeName], fieldName)
  ) {
    return { eligible: false, reason: "another schema feature references the field" };
  }
  return { eligible: true };
}

/** Inputs for {@link canConvertField}. */
export interface CanConvertFieldOptions {
  previous: SchemaSnapshot;
  current: SchemaSnapshot;
  typeName: string;
  fieldName: string;
}

/**
 * Names a type already exposes, which a temporary field cannot reuse.
 * @param type - Type to enumerate
 * @returns Field, file, and relationship names
 */
function typeMemberNames(type: TailorDBSnapshotType | undefined): string[] {
  if (!type) return [];
  return [
    ...Object.keys(type.fields),
    ...Object.keys(type.files ?? {}),
    ...Object.keys(type.forwardRelationships ?? {}),
    ...Object.keys(type.backwardRelationships ?? {}),
  ];
}

/**
 * Whether anything other than the field list names this field.
 *
 * The pair moves values through a differently named field, and only the field
 * list is rewritten. An index, relationship, permission, or script naming the
 * field would keep pointing at the name the pair drops.
 * @param type - Type holding the field
 * @param fieldName - Field being converted
 * @returns Whether another part of the type names the field
 */
function isFieldReferenced(type: TailorDBSnapshotType | undefined, fieldName: string): boolean {
  if (!type) return false;
  const indexed = Object.values(type.indexes ?? {}).some((index) =>
    index.fields.includes(fieldName),
  );
  if (indexed) return true;
  const related = [
    ...Object.values(type.forwardRelationships ?? {}),
    ...Object.values(type.backwardRelationships ?? {}),
  ].some(
    (relationship) =>
      relationship.sourceField === fieldName || relationship.targetField === fieldName,
  );
  if (related) return true;
  const scripts = [type.typeHookExpr, type.typeValidateExpr, type.permissions]
    .filter(Boolean)
    .map((value) => JSON.stringify(value))
    .join("");
  return scripts.includes(fieldName);
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
    if (
      !canConvertField({
        previous,
        current,
        typeName: change.typeName,
        fieldName: change.fieldName,
      })
    ) {
      continue;
    }

    // A temporary field shares the type's GraphQL namespace with its files and
    // relationships, so a name taken by either is not available.
    const taken = new Set([
      ...typeMemberNames(previous.types[change.typeName]),
      ...typeMemberNames(current.types[change.typeName]),
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
