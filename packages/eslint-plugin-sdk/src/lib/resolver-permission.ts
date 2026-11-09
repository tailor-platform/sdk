import {
  type AstNode,
  literalElements,
  literalProperties,
  literalProperty,
  staticBoolean,
  staticString,
  unwrapExpression,
} from "./ast.js";
import { resolveValue } from "./sdk-bindings.js";
import type { Rule } from "eslint";

const OPERATORS = new Set(["=", "!="]);

type Operand =
  | { kind: "user"; key: string | null }
  | { kind: "input"; field: string | null }
  | { kind: "string" | "boolean" | "invalid" }
  | { kind: "unknown" };

export function operand(context: Rule.RuleContext, node: AstNode): Operand {
  const value = unwrapExpression(resolveValue(context, node));
  if (value?.type === "Literal" && typeof value.value === "string") return { kind: "string" };
  if (value?.type === "Literal" && typeof value.value === "boolean") return { kind: "boolean" };
  if (value?.type === "Literal") return { kind: "invalid" };
  if (literalProperties(value) === null) return { kind: "unknown" };
  const input = literalProperty(value, "input");
  if (input !== null) {
    return { kind: "input", field: staticString(resolveValue(context, input.value)) };
  }
  const user = literalProperty(value, "user");
  if (user === null) return { kind: "invalid" };
  return { kind: "user", key: staticString(resolveValue(context, user.value)) };
}

function isConditionTuple(context: Rule.RuleContext, elements: readonly AstNode[]): boolean {
  const operator = elements[1];
  return (
    elements.length === 3 &&
    operator !== undefined &&
    OPERATORS.has(staticString(resolveValue(context, operator)) ?? "")
  );
}

export type ConditionTuple = { node: AstNode; elements: readonly AstNode[] };

/** The condition tuples in a policy's `conditions`, and whether every condition is one. */
export function conditionTuples(
  context: Rule.RuleContext,
  value: AstNode,
  elements: readonly AstNode[],
): { tuples: ConditionTuple[]; complete: boolean } {
  if (isConditionTuple(context, elements)) {
    return { tuples: [{ node: value, elements }], complete: true };
  }
  const tuples = elements.flatMap((element) => {
    const tuple = resolveValue(context, element);
    const tupleElements = literalElements(tuple);
    return tuple && tupleElements !== null && isConditionTuple(context, tupleElements)
      ? [{ node: tuple, elements: tupleElements }]
      : [];
  });
  return { tuples, complete: tuples.length === elements.length };
}

export function policyPermit(
  context: Rule.RuleContext,
  policy: AstNode | null | undefined,
): boolean | null {
  return staticBoolean(resolveValue(context, literalProperty(policy, "permit")?.value));
}

/**
 * The input fields a resolver `permission` compares with the caller; null when any part of it
 * cannot be read statically.
 */
export function permissionInputFields(
  context: Rule.RuleContext,
  node: AstNode,
): Set<string> | null {
  const value = resolveValue(context, node);
  if (staticString(value) === "allowAnonymous") return new Set();
  const policies = literalElements(value);
  if (policies === null) return null;
  const fields = new Set<string>();
  for (const element of policies) {
    const policy = resolveValue(context, element);
    if (literalProperties(policy) === null) return null;
    const property = literalProperty(policy, "conditions");
    if (property === null) continue;
    const conditions = resolveValue(context, property.value);
    const elements = literalElements(conditions);
    if (conditions === null || conditions === undefined || elements === null) return null;
    const { tuples, complete } = conditionTuples(context, conditions, elements);
    if (!complete) return null;
    for (const tuple of tuples) {
      for (const side of [tuple.elements[0], tuple.elements[2]]) {
        const sideOperand = side === undefined ? undefined : operand(context, side);
        if (sideOperand?.kind === "unknown") return null;
        if (sideOperand?.kind === "input") {
          if (sideOperand.field === null) return null;
          fields.add(sideOperand.field);
        }
      }
    }
  }
  return fields;
}
