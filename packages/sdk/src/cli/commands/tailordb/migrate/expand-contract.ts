/**
 * Planning for field type changes that move values through a temporary field.
 *
 * A change that cannot be applied in place is split into two migrations: the
 * first adds a temporary field and converts values into it, the second renames
 * that field back over the original.
 */

import { parseSync } from "oxc-parser";
import { getExpandContractFieldChangeEligibility } from "./field-type-change";
import { isSnapshotFieldRefOperand } from "./snapshot-types";
import type { BreakingChangeInfo, MigrationDiff } from "./diff-calculator";
import type {
  SchemaSnapshot,
  SnapshotFieldConfig,
  SnapshotPermissionCondition,
  TailorDBSnapshotType,
} from "./snapshot-types";
import type { Node, PropertyKey } from "@oxc-project/types";

/** Longest field name the platform accepts. */
const MAX_FIELD_NAME_LENGTH = 63;

const TEMP_FIELD_SUFFIX = "Migrate";

/** One field type change to carry through a temporary field. */
export interface ExpandContractPlan {
  tableName: string;
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
 * @param tableName - Name of the table holding the field
 * @param fieldName - Name of the field
 * @returns Key in `Table.field` form
 */
export function fieldKey(tableName: string, fieldName: string): string {
  return `${tableName}.${fieldName}`;
}

/**
 * Derive the temporary field name to carry a field's converted values.
 *
 * Field names cannot hold an underscore, so the suffix is camelCase and a
 * collision is resolved by an ordinal rather than a separator.
 * @param fieldName - Field being converted
 * @param taken - Field names already in use for the same table
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
  /** `Table.field` keys the user approved for automation. */
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
  const { previous, current, tableName, fieldName } = options;
  const before = previous.tables[tableName]?.fields[fieldName];
  const after = current.tables[tableName]?.fields[fieldName];
  if (!before || !after) {
    return { eligible: false, reason: "the field does not exist in both schemas" };
  }
  const fieldEligibility = getExpandContractFieldChangeEligibility(before, after);
  if (!fieldEligibility.eligible) return fieldEligibility;
  if (
    isFieldReferenced(previous.tables[tableName], fieldName) ||
    isFieldReferenced(current.tables[tableName], fieldName)
  ) {
    return { eligible: false, reason: "another schema feature references the field" };
  }
  return { eligible: true };
}

/** Inputs for {@link canConvertField}. */
export interface CanConvertFieldOptions {
  previous: SchemaSnapshot;
  current: SchemaSnapshot;
  tableName: string;
  fieldName: string;
}

/**
 * Names a table already exposes, which a temporary field cannot reuse.
 * @param type - Table to enumerate
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

function staticPropertyName(key: PropertyKey, computed: boolean): string | undefined {
  if (!computed && key.type === "Identifier") return key.name;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  if (key.type === "TemplateLiteral" && key.expressions.length === 0) {
    return key.quasis[0]?.value.cooked ?? undefined;
  }
  return undefined;
}

const SCRIPT_CONTEXT_ARGUMENTS = new Set(["input", "newRecord", "oldRecord", "invoker", "now"]);

function walkScriptAst(
  node: Node | null | undefined,
  visit: (node: Node, ancestors: readonly Node[]) => void,
  ancestors: readonly Node[] = [],
): void {
  if (!node) return;
  visit(node, ancestors);
  const nestedAncestors = [...ancestors, node];
  const record = node as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (key === "type" || key === "parent") continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object" && "type" in item) {
          walkScriptAst(item as Node, visit, nestedAncestors);
        }
      }
    } else if (value && typeof value === "object" && "type" in value) {
      walkScriptAst(value as Node, visit, nestedAncestors);
    }
  }
}

function unwrapFunction(node: Node): Node {
  return node.type === "ParenthesizedExpression" ? unwrapFunction(node.expression) : node;
}

function collectIssueBindings(program: Node): Set<string> {
  const issueBindings = new Set(["__issues"]);
  walkScriptAst(program, (node) => {
    if (node.type !== "CallExpression") return;
    const callee = unwrapFunction(node.callee);
    if (
      (callee.type !== "ArrowFunctionExpression" && callee.type !== "FunctionExpression") ||
      node.arguments[1]?.type !== "Identifier" ||
      node.arguments[1].name !== "__issues"
    ) {
      return;
    }
    const issueParameter = callee.params[1];
    if (issueParameter?.type === "Identifier") issueBindings.add(issueParameter.name);
  });

  let addedBinding: boolean;
  do {
    const previousSize = issueBindings.size;
    walkScriptAst(program, (node) => {
      if (
        node.type === "VariableDeclarator" &&
        node.id.type === "Identifier" &&
        node.init?.type === "Identifier" &&
        issueBindings.has(node.init.name)
      ) {
        issueBindings.add(node.id.name);
      }
    });
    addedBinding = issueBindings.size > previousSize;
  } while (addedBinding);
  return issueBindings;
}

function isWrapperArgumentProperty(node: Node, ancestors: readonly Node[]): boolean {
  if (node.type !== "Property") return false;
  const propertyName = staticPropertyName(node.key, node.computed);
  if (!propertyName || !SCRIPT_CONTEXT_ARGUMENTS.has(propertyName)) return false;
  const object = ancestors.at(-1);
  const call = ancestors.at(-2);
  if (object?.type !== "ObjectExpression" || call?.type !== "CallExpression") return false;
  return (
    call.arguments[0] === object &&
    ["ArrowFunctionExpression", "FunctionExpression"].includes(unwrapFunction(call.callee).type)
  );
}

function isWrapperParameterProperty(node: Node, ancestors: readonly Node[]): boolean {
  if (node.type !== "Property") return false;
  const propertyName = staticPropertyName(node.key, node.computed);
  if (!propertyName || !SCRIPT_CONTEXT_ARGUMENTS.has(propertyName)) return false;
  const pattern = ancestors.at(-1);
  if (pattern?.type !== "ObjectPattern") return false;

  for (let index = ancestors.length - 2; index >= 0; index--) {
    const candidate = ancestors[index];
    if (
      candidate &&
      (candidate.type === "ArrowFunctionExpression" || candidate.type === "FunctionExpression") &&
      candidate.params[0] === pattern
    ) {
      return ancestors
        .slice(0, index)
        .some(
          (ancestor) =>
            ancestor.type === "CallExpression" &&
            unwrapFunction(ancestor.callee) === candidate &&
            ancestor.arguments[0]?.type === "ObjectExpression" &&
            ancestor.arguments[0].properties.some(
              (property) =>
                property.type === "Property" &&
                staticPropertyName(property.key, property.computed) === propertyName,
            ),
        );
    }
  }
  return false;
}

function isIssueMessage(
  node: Node,
  ancestors: readonly Node[],
  issueBindings: ReadonlySet<string>,
): boolean {
  const call = ancestors.at(-1);
  return (
    call?.type === "CallExpression" &&
    call.callee.type === "Identifier" &&
    issueBindings.has(call.callee.name) &&
    call.arguments.findIndex((argument) => argument === node) > 0
  );
}

function scriptReferencesField(script: string, fieldName: string): boolean {
  try {
    const { program, errors } = parseSync("expand-contract-reference.js", script, {
      sourceType: "module",
    });
    if (errors.length > 0) return true;

    const issueBindings = collectIssueBindings(program);

    let referenced = false;
    walkScriptAst(program, (node, ancestors) => {
      if (referenced) return;
      if (
        node.type === "MemberExpression" &&
        (staticPropertyName(node.property, node.computed) === fieldName ||
          (node.computed && staticPropertyName(node.property, true) === undefined))
      ) {
        referenced = true;
      } else if (
        node.type === "Property" &&
        (staticPropertyName(node.key, node.computed) === fieldName ||
          (node.computed && staticPropertyName(node.key, true) === undefined)) &&
        (node.computed ||
          (!isWrapperArgumentProperty(node, ancestors) &&
            !isWrapperParameterProperty(node, ancestors)))
      ) {
        referenced = true;
      } else if (
        node.type === "CallExpression" &&
        node.callee.type === "Identifier" &&
        issueBindings.has(node.callee.name) &&
        node.arguments[0] !== undefined &&
        node.arguments[0].type !== "SpreadElement" &&
        staticPropertyName(node.arguments[0], true) === fieldName
      ) {
        referenced = true;
      } else if (
        (node.type === "Literal" || node.type === "TemplateLiteral") &&
        staticPropertyName(node, true) === fieldName &&
        !isIssueMessage(node, ancestors, issueBindings)
      ) {
        referenced = true;
      }
    });
    return referenced;
  } catch {
    return true;
  }
}

function permissionsReferenceField(
  permissions: TailorDBSnapshotType["permissions"],
  fieldName: string,
): boolean {
  if (!permissions) return false;
  const recordPolicies = permissions.record
    ? Object.values(permissions.record).flatMap((policies) => policies)
    : [];
  const policies = [...recordPolicies, ...(permissions.gql ?? [])];
  return policies.some((policy) =>
    policy.conditions.some((condition: SnapshotPermissionCondition) => {
      const [left, , right] = condition;
      return [left, right].some(
        (operand) =>
          isSnapshotFieldRefOperand(operand) &&
          (("record" in operand && operand.record === fieldName) ||
            ("newRecord" in operand && operand.newRecord === fieldName) ||
            ("oldRecord" in operand && operand.oldRecord === fieldName)),
      );
    }),
  );
}

/**
 * Whether anything other than the field list names this field.
 *
 * The pair moves values through a differently named field, and only the field
 * list is rewritten. An index, relationship, permission, or script naming the
 * field would keep pointing at the name the pair drops.
 * @param type - Table holding the field
 * @param fieldName - Field being converted
 * @returns Whether another part of the table names the field
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
  if (permissionsReferenceField(type.permissions, fieldName)) return true;
  return [type.typeHookExpr?.create, type.typeHookExpr?.update, type.typeValidateExpr]
    .filter((script): script is string => script !== undefined)
    .some((script) => scriptReferencesField(script, fieldName));
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
    const key = fieldKey(change.tableName, change.fieldName);
    if (!confirmed.has(key)) continue;
    if (
      !canConvertField({
        previous,
        current,
        tableName: change.tableName,
        fieldName: change.fieldName,
      })
    ) {
      continue;
    }

    // A temporary field shares the table's GraphQL namespace with its files and
    // relationships, so a name taken by either is not available.
    const taken = new Set([
      ...typeMemberNames(previous.tables[change.tableName]),
      ...typeMemberNames(current.tables[change.tableName]),
      ...plans
        .filter((plan) => plan.tableName === change.tableName)
        .map((plan) => plan.tempFieldName),
    ]);
    plans.push({
      tableName: change.tableName,
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
      !(change.fieldName && planned.has(fieldKey(change.tableName, change.fieldName))),
  );

  return { plans, blocked };
}
