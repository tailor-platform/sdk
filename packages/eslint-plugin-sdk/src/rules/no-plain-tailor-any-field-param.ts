import { type AstMethodDefinition, type AstNode, propertyName } from "../lib/ast.js";
import { configureTypeImportTracker } from "../lib/sdk-bindings.js";
import type { Rule } from "eslint";

interface TsNode {
  type: string;
  parent?: TsNode;
  [key: string]: unknown;
}

const FUNCTION_TYPES: ReadonlySet<string> = new Set([
  "ArrowFunctionExpression",
  "FunctionDeclaration",
  "FunctionExpression",
  "TSDeclareFunction",
  "TSEmptyBodyFunctionExpression",
]);

const FIELD_CONTAINER_TYPES: ReadonlySet<string> = new Set([
  "TSArrayType",
  "TSIndexSignature",
  "TSIntersectionType",
  "TSMappedType",
  "TSNamedTupleMember",
  "TSOptionalType",
  "TSPropertySignature",
  "TSRestType",
  "TSTupleType",
  "TSTypeLiteral",
  "TSTypeParameterInstantiation",
  "TSTypeReference",
  "TSUnionType",
]);

function asAstNode(node: unknown): AstNode {
  return node as AstNode;
}

function containsField(node: TsNode): boolean {
  if (node.type === "TSTypeOperator") return node.operator === "readonly";
  return FIELD_CONTAINER_TYPES.has(node.type);
}

function annotatedOwner(reference: TsNode): TsNode | null {
  let node = reference.parent;
  while (node !== undefined) {
    if (node.type === "TSTypeAnnotation") {
      const owner = node.parent;
      if (owner?.type !== "TSPropertySignature" && owner?.type !== "TSIndexSignature") {
        return owner ?? null;
      }
    } else if (!containsField(node)) {
      return null;
    }
    node = node.parent;
  }
  return null;
}

function parameterFunction(owner: TsNode): TsNode | null {
  let parameter = owner;
  let parent = owner.parent;
  if (parent?.type === "AssignmentPattern" && parent.left === parameter) {
    parameter = parent;
    parent = parent.parent;
  }
  if (parent?.type === "TSParameterProperty") {
    parameter = parent;
    parent = parent.parent;
  }
  if (parent === undefined || !FUNCTION_TYPES.has(parent.type)) return null;
  return (parent.params as TsNode[]).includes(parameter) ? parent : null;
}

function keyName(node: TsNode): string | null {
  return propertyName(node as unknown as AstMethodDefinition);
}

function isCallArgument(fn: TsNode): boolean {
  const parent = fn.parent;
  if (parent?.type !== "CallExpression" && parent?.type !== "NewExpression") return false;
  return (parent.arguments as TsNode[]).includes(fn);
}

function declaredFunctionName(statement: TsNode): string | null {
  const declaration =
    statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration"
      ? (statement.declaration as TsNode | null)
      : statement;
  if (declaration?.type !== "TSDeclareFunction") return null;
  return ((declaration.id as TsNode | null)?.name as string | undefined) ?? null;
}

function isOverloadImplementation(fn: TsNode): boolean {
  if (fn.type === "FunctionDeclaration") {
    const name = (fn.id as TsNode | null)?.name;
    if (name === undefined) return false;
    const statement = fn.parent?.type.startsWith("Export") ? fn.parent : fn;
    const siblings = (statement.parent?.body ?? []) as TsNode[];
    return siblings.some((sibling) => declaredFunctionName(sibling) === name);
  }
  const method = fn.parent;
  if (fn.type !== "FunctionExpression" || method?.type !== "MethodDefinition") return false;
  const name = keyName(method);
  if (name === null) return false;
  const members = (method.parent?.body ?? []) as TsNode[];
  return members.some(
    (member) =>
      member.type === "MethodDefinition" &&
      (member.value as TsNode).type === "TSEmptyBodyFunctionExpression" &&
      keyName(member) === name,
  );
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow TailorAnyField as a plain parameter type.",
    },
    messages: {
      plainParam:
        "A parameter typed with TailorAnyField makes the field's output type any; constrain a type parameter instead, such as <F extends TailorAnyField>(field: F).",
    },
    schema: [],
  },
  create(context) {
    const imports = configureTypeImportTracker(context);
    const references: TsNode[] = [];

    const isTailorAnyField = (reference: TsNode): boolean => {
      const name = reference.typeName as TsNode;
      if (name.type === "Identifier") return imports.importedAs(asAstNode(name), "TailorAnyField");
      if (name.type !== "TSQualifiedName") return false;
      const left = name.left as TsNode;
      const right = name.right as TsNode;
      return right.name === "TailorAnyField" && imports.isNamespace(asAstNode(left));
    };

    return {
      ImportDeclaration: (node) => imports.track(node),
      TSTypeReference: (node: unknown) => references.push(node as TsNode),
      "Program:exit"() {
        for (const reference of references) {
          if (!isTailorAnyField(reference)) continue;
          const owner = annotatedOwner(reference);
          const fn = owner === null ? null : parameterFunction(owner);
          if (fn === null || isCallArgument(fn) || isOverloadImplementation(fn)) continue;
          context.report({ node: asAstNode(reference), messageId: "plainParam" });
        }
      },
    };
  },
} satisfies Rule.RuleModule;

export default rule;
