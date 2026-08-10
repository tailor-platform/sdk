import {
  type AstArrayExpression,
  type AstCallExpression,
  type AstNode,
  memberName,
  objectProperty,
  unwrapExpression,
} from "../lib/ast.js";
import { configureImportTracker, type ImportTracker, resolveValue } from "../lib/sdk-bindings.js";
import type { Rule } from "eslint";

type IdentifierNode = Extract<Rule.Node, { type: "Identifier" }>;
type MemberExpressionNode = Extract<Rule.Node, { type: "MemberExpression" }>;

const UNSAFE_CONSTANTS: ReadonlySet<string> = new Set([
  "unsafeAllowAllTypePermission",
  "unsafeAllowAllGqlPermission",
  "unsafeAllowAllIdPPermission",
]);

function isValueReference(node: IdentifierNode): boolean {
  const parent = node.parent as AstNode;
  switch (parent.type) {
    case "ImportSpecifier":
    case "ImportDefaultSpecifier":
    case "ImportNamespaceSpecifier":
      return false;
    case "MemberExpression":
    case "OptionalMemberExpression":
      return parent.object === node || parent.computed;
    case "Property":
      return parent.value === node || parent.computed;
    default:
      return true;
  }
}

function isDbReference(imports: ImportTracker, node: AstNode | null | undefined): boolean {
  const object = unwrapExpression(node);
  if (object?.type === "Identifier") return imports.importedAs(object, "db");
  if (object?.type === "MemberExpression" || object?.type === "OptionalMemberExpression") {
    return memberName(object) === "db" && imports.isNamespace(unwrapExpression(object.object));
  }
  return false;
}

function isDbTypeReceiver(
  context: Rule.RuleContext,
  imports: ImportTracker,
  node: AstNode | null | undefined,
): boolean {
  let current = resolveValue(context, node);
  while (current?.type === "CallExpression") {
    const callee = unwrapExpression(current.callee);
    if (callee?.type !== "MemberExpression" && callee?.type !== "OptionalMemberExpression") {
      return false;
    }
    if (memberName(callee) === "type" && isDbReference(imports, callee.object)) return true;
    current = resolveValue(context, callee.object);
  }
  return false;
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
  if (!isDbTypeReceiver(context, imports, callee.object)) return null;
  return call.arguments[0] ?? null;
}

function isUnconditionalObjectEntry(context: Rule.RuleContext, entry: AstNode): boolean {
  const conditions = objectProperty(entry, "conditions");
  const permit = objectProperty(entry, "permit");
  if (conditions === null || permit === null) return false;
  const conditionsValue = resolveValue(context, conditions.value);
  const permitValue = unwrapExpression(permit.value);
  return (
    conditionsValue?.type === "ArrayExpression" &&
    conditionsValue.elements.length === 0 &&
    permitValue?.type === "Literal" &&
    permitValue.value === true
  );
}

function isUnconditionalShorthandEntry(entry: AstArrayExpression): boolean {
  let permit = true;
  for (const element of entry.elements) {
    if (element === null || element.type === "SpreadElement") return false;
    const value = unwrapExpression(element);
    if (value?.type !== "Literal" || typeof value.value !== "boolean") return false;
    permit = value.value;
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

const rule = {
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
    const identifiers: IdentifierNode[] = [];
    const members: MemberExpressionNode[] = [];

    return {
      ImportDeclaration: (node) => imports.track(node),
      CallExpression: (node) => calls.push(node),
      Identifier: (node) => identifiers.push(node),
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
} satisfies Rule.RuleModule;

export default rule;
