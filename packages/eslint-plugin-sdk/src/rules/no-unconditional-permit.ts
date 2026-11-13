import {
  type AstArrayExpression,
  type AstCallExpression,
  type AstNode,
  isValueReference,
  memberName,
  objectProperty,
  staticBoolean,
  unwrapExpression,
} from "../lib/ast.js";
import {
  configureImportTracker,
  type ImportTracker,
  resolveValue,
  sdkChainRoot,
} from "../lib/sdk-bindings.js";
import type { Rule } from "eslint";

type IdentifierNode = Extract<Rule.Node, { type: "Identifier" }>;
type MemberExpressionNode = Extract<Rule.Node, { type: "MemberExpression" }>;

const UNSAFE_CONSTANTS: ReadonlySet<string> = new Set([
  "unsafeAllowAllTypePermission",
  "unsafeAllowAllGqlPermission",
  "unsafeAllowAllIdPPermission",
]);

function isDbTableReceiver(
  context: Rule.RuleContext,
  imports: ImportTracker,
  node: AstNode | null | undefined,
): boolean {
  const root = sdkChainRoot(context, imports, node);
  return root?.receiver === "db" && (root.method === "type" || root.method === "table");
}

function permissionArgument(
  context: Rule.RuleContext,
  imports: ImportTracker,
  call: AstCallExpression,
): AstNode | null {
  if (imports.callName(call) === "defineIdp") {
    const options = resolveValue(context, call.arguments[1]);
    const property = objectProperty(options, "permission");
    return property?.value ?? null;
  }
  const callee = unwrapExpression(call.callee);
  if (callee?.type !== "MemberExpression" && callee?.type !== "OptionalMemberExpression") {
    return null;
  }
  const method = memberName(callee);
  if (method !== "permission" && method !== "gqlPermission") return null;
  if (!isDbTableReceiver(context, imports, callee.object)) return null;
  return call.arguments[0] ?? null;
}

function isUnconditionalObjectEntry(context: Rule.RuleContext, entry: AstNode): boolean {
  const conditions = objectProperty(entry, "conditions");
  const permit = objectProperty(entry, "permit");
  if (conditions === null || permit === null) return false;
  const conditionsValue = resolveValue(context, conditions.value);
  return (
    conditionsValue?.type === "ArrayExpression" &&
    conditionsValue.elements.length === 0 &&
    staticBoolean(permit.value) === true
  );
}

function isUnconditionalShorthandEntry(entry: AstArrayExpression): boolean {
  let permit = true;
  for (const element of entry.elements) {
    if (element === null || element.type === "SpreadElement") return false;
    const value = staticBoolean(element);
    if (value === null) return false;
    permit = value;
  }
  return permit;
}

function reportEntry(context: Rule.RuleContext, node: AstNode): void {
  const entry = resolveValue(context, node);
  if (entry?.type === "ObjectExpression" && isUnconditionalObjectEntry(context, entry)) {
    context.report({ node: entry, messageId: "unconditionalEntry" });
    return;
  }
  if (entry?.type === "ArrayExpression" && isUnconditionalShorthandEntry(entry)) {
    context.report({ node: entry, messageId: "unconditionalEntry" });
  }
}

function reportEntryList(context: Rule.RuleContext, node: AstNode): void {
  const entries = resolveValue(context, node);
  if (entries?.type !== "ArrayExpression") return;
  for (const element of entries.elements) {
    if (element !== null && element.type !== "SpreadElement") reportEntry(context, element);
  }
}

function reportUnconditionalEntries(context: Rule.RuleContext, node: AstNode): void {
  const value = resolveValue(context, node);
  if (value?.type === "ArrayExpression") {
    reportEntryList(context, value);
    return;
  }
  if (value?.type !== "ObjectExpression") return;
  for (const property of value.properties) {
    if (property.type === "Property") reportEntryList(context, property.value);
  }
}

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow permission settings that grant access unconditionally.",
    },
    messages: {
      unsafeConstant:
        "{{name}} grants access unconditionally; define restrictive permission conditions instead.",
      unconditionalEntry:
        "This permission entry permits access without any conditions; add conditions or remove it.",
    },
    schema: [],
  },
  create(context) {
    const imports = configureImportTracker(context);
    const calls: AstCallExpression[] = [];
    const identifiers = new Set<IdentifierNode>();
    const members: MemberExpressionNode[] = [];

    return {
      ImportDeclaration: (node) => imports.track(node),
      CallExpression: (node) => calls.push(node),
      Identifier: (node) => identifiers.add(node),
      MemberExpression: (node) => {
        if (UNSAFE_CONSTANTS.has(memberName(node) ?? "")) members.push(node);
      },
      "Program:exit"() {
        for (const node of identifiers) {
          const name = imports.importedName(node);
          if (name === null || !UNSAFE_CONSTANTS.has(name) || !isValueReference(node)) {
            continue;
          }
          context.report({ node, messageId: "unsafeConstant", data: { name } });
        }
        for (const node of members) {
          if (!imports.isNamespace(unwrapExpression(node.object))) continue;
          const name = memberName(node);
          if (name === null) continue;
          context.report({ node, messageId: "unsafeConstant", data: { name } });
        }
        for (const call of calls) {
          const permission = permissionArgument(context, imports, call);
          if (permission !== null) reportUnconditionalEntries(context, permission);
        }
      },
    };
  },
};

export default rule;
