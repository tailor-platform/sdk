import {
  type AstCallExpression,
  type AstNode,
  literalElements,
  literalProperties,
  literalProperty,
  staticString,
  unwrapExpression,
} from "../lib/ast.js";
import { configureImportTracker, resolveValue } from "../lib/sdk-bindings.js";
import type { Rule } from "eslint";

// Only the fixed `user` keys have a known value type; custom attributes are
// typed in the configure layer's generic, so they are not checked here.
const KNOWN_USER_OPERAND_TYPES: Record<string, "string" | "boolean"> = {
  _loggedIn: "boolean",
  id: "string",
};

const OPERATORS = new Set(["=", "!="]);

type Operand =
  | { kind: "user"; key: string | null }
  | { kind: "string" | "boolean" | "input" | "invalid" }
  | { kind: "unknown" };

function operand(context: Rule.RuleContext, node: AstNode): Operand {
  const value = unwrapExpression(resolveValue(context, node));
  if (value?.type === "Literal" && typeof value.value === "string") return { kind: "string" };
  if (value?.type === "Literal" && typeof value.value === "boolean") return { kind: "boolean" };
  if (value?.type === "Literal") return { kind: "invalid" };
  if (literalProperties(value) === null) return { kind: "unknown" };
  if (literalProperty(value, "input") !== null) return { kind: "input" };
  const user = literalProperty(value, "user");
  if (user === null) return { kind: "invalid" };
  return { kind: "user", key: staticString(resolveValue(context, user.value)) };
}

function conditionTuples(context: Rule.RuleContext, node: AstNode): AstNode[][] {
  const elements = literalElements(resolveValue(context, node));
  if (elements === null) return [];
  if (isConditionTuple(context, elements)) return [elements];
  return elements.flatMap((element) => {
    const tupleElements = literalElements(resolveValue(context, element));
    return tupleElements !== null && isConditionTuple(context, tupleElements)
      ? [tupleElements]
      : [];
  });
}

function hasInputOperand(context: Rule.RuleContext, conditions: AstNode): boolean {
  return conditionTuples(context, conditions).some((tuple) =>
    [tuple[0], tuple[2]].some(
      (side) => side !== undefined && operand(context, side).kind === "input",
    ),
  );
}

function isConditionTuple(context: Rule.RuleContext, elements: readonly AstNode[]): boolean {
  const operator = elements[1];
  return (
    elements.length === 3 &&
    operator !== undefined &&
    OPERATORS.has(staticString(resolveValue(context, operator)) ?? "")
  );
}

function checkCondition(
  context: Rule.RuleContext,
  tuple: AstNode,
  elements: readonly AstNode[],
): void {
  const [left, operator, right] = elements;
  if (left === undefined || operator === undefined || right === undefined) return;
  const operands = [operand(context, left), operand(context, right)];
  if (operands.some((entry) => entry.kind === "unknown")) return;
  const user = operands.find((entry) => entry.kind === "user");
  const other = operands.find((entry) => entry.kind !== "user");
  const hasInput = operands.some((entry) => entry.kind === "input");
  if (user === undefined && hasInput) {
    context.report({ node: tuple, messageId: "inputOperandSide" });
    return;
  }
  if (hasInput && staticString(resolveValue(context, operator)) !== "=") {
    context.report({ node: tuple, messageId: "inputOperandOperator" });
    return;
  }
  if (user?.kind !== "user" || other === undefined) {
    context.report({ node: tuple, messageId: "userOperandSide" });
    return;
  }
  if (other.kind === "invalid") {
    context.report({ node: tuple, messageId: "operandValue" });
    return;
  }
  const expected = user.key === null ? undefined : KNOWN_USER_OPERAND_TYPES[user.key];
  const otherType = other.kind === "input" ? "string" : other.kind;
  if (expected !== undefined && otherType !== expected) {
    context.report({
      node: tuple,
      messageId: "operandType",
      data: { key: user.key ?? "", expected },
    });
  }
}

function checkConditions(context: Rule.RuleContext, node: AstNode): void {
  const value = resolveValue(context, node);
  const elements = literalElements(value);
  if (value === null || value === undefined || elements === null) return;
  if (isConditionTuple(context, elements)) {
    checkCondition(context, value, elements);
    return;
  }
  if (elements.length === 0) {
    context.report({ node: value, messageId: "emptyConditions" });
    return;
  }
  for (const element of elements) {
    const tuple = resolveValue(context, element);
    const tupleElements = literalElements(tuple);
    if (tuple && tupleElements !== null && isConditionTuple(context, tupleElements)) {
      checkCondition(context, tuple, tupleElements);
    }
  }
}

type PermissionScope = "resolver" | "namespace";

function checkPermission(context: Rule.RuleContext, node: AstNode, scope: PermissionScope): void {
  const value = resolveValue(context, node);
  if (value === null || value === undefined || staticString(value) === "allowAnonymous") return;
  const policies = literalElements(value);
  if (policies === null) return;
  if (policies.length === 0) {
    context.report({ node: value, messageId: "emptyPolicies" });
    return;
  }
  let permitKnown = true;
  let permits = false;
  for (const element of policies) {
    const policy = resolveValue(context, element);
    if (literalProperties(policy) === null) {
      permitKnown = false;
      continue;
    }
    const permit = unwrapExpression(
      resolveValue(context, literalProperty(policy, "permit")?.value),
    );
    const permitValue =
      permit?.type === "Literal" && typeof permit.value === "boolean" ? permit.value : null;
    if (permitValue === null) {
      permitKnown = false;
    } else {
      permits ||= permitValue;
    }
    const conditions = literalProperty(policy, "conditions");
    if (conditions === null) continue;
    checkConditions(context, conditions.value);
    if (hasInputOperand(context, conditions.value)) {
      if (scope === "namespace") {
        context.report({ node: conditions.value, messageId: "inputOperandInDefault" });
      } else if (permitValue === false) {
        context.report({ node: conditions.value, messageId: "inputOperandInDeny" });
      }
    }
  }
  if (permitKnown && !permits) context.report({ node: value, messageId: "noPermitPolicy" });
}

function defaultPermissions(context: Rule.RuleContext, config: AstCallExpression): AstNode[] {
  const resolver = literalProperty(resolveValue(context, config.arguments[0]), "resolver");
  const namespaces = literalProperties(resolveValue(context, resolver?.value));
  if (namespaces === null) return [];
  return namespaces.flatMap((namespace) => {
    const permission = literalProperty(resolveValue(context, namespace.value), "defaultPermission");
    return permission === null ? [] : [permission.value];
  });
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require literal resolver permissions to satisfy the constraints the build validates.",
    },
    messages: {
      emptyPolicies: "Resolver permission must have at least one policy.",
      noPermitPolicy:
        "Resolver permission must include at least one `permit: true` policy; a policy list with only `permit: false` policies lets through any caller who does not authenticate.",
      emptyConditions: "Resolver permission policy must have at least one condition.",
      userOperandSide:
        "Resolver permission condition must reference a `user` operand on exactly one side (comparing two `user` operands to each other can match on `undefined === undefined`).",
      operandType: "`{{key}}` must compare to a {{expected}}.",
      operandValue: "A `user` operand must compare to a string, a boolean, or an `input` operand.",
      inputOperandSide: "An `input` operand must be compared to a `user` operand.",
      inputOperandOperator: "An `input` operand can only be compared with `=`.",
      inputOperandInDeny: "An `input` operand can only be used in a `permit: true` policy.",
      inputOperandInDefault:
        "`defaultPermission` cannot use an `input` operand, since a namespace has no input.",
    },
    schema: [],
  },
  create(context) {
    const imports = configureImportTracker(context);
    const calls: AstCallExpression[] = [];

    return {
      ImportDeclaration: (node) => imports.track(node),
      CallExpression: (node) => calls.push(node),
      "Program:exit"() {
        for (const call of calls) {
          const name = imports.callName(call);
          if (name === "createResolver") {
            const permission = literalProperty(
              resolveValue(context, call.arguments[0]),
              "permission",
            );
            if (permission !== null) checkPermission(context, permission.value, "resolver");
          } else if (name === "defineConfig") {
            for (const permission of defaultPermissions(context, call)) {
              checkPermission(context, permission, "namespace");
            }
          }
        }
      },
    };
  },
} satisfies Rule.RuleModule;

export default rule;
