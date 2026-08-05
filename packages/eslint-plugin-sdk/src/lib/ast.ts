import type { Rule } from "eslint";

type WithoutParent<Node> = Node extends unknown ? Omit<Node, "parent"> : never;
type EstreeNode = WithoutParent<Rule.Node>;
const EXPRESSION_WRAPPER_TYPES = [
  "TSAsExpression",
  "TSInstantiationExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
  "TypeCastExpression",
] as const;

type ExpressionWrapperType = (typeof EXPRESSION_WRAPPER_TYPES)[number];

interface ExpressionWrapperNode {
  type: ExpressionWrapperType;
  expression: AstNode;
  range?: [number, number];
  start?: number;
}

interface OptionalMemberExpressionNode {
  type: "OptionalMemberExpression";
  object: AstNode;
  property: AstNode;
  computed: boolean;
  range?: [number, number];
  start?: number;
}

export type AstNode = EstreeNode | ExpressionWrapperNode | OptionalMemberExpressionNode;
export type AstArrayExpression = Extract<EstreeNode, { type: "ArrayExpression" }>;
export type AstCallExpression = Extract<EstreeNode, { type: "CallExpression" }>;
export type AstIdentifier = Extract<EstreeNode, { type: "Identifier" }>;
export type AstImportDeclaration = Extract<EstreeNode, { type: "ImportDeclaration" }>;
type AstProperty = Extract<EstreeNode, { type: "Property" }>;

const EXPRESSION_WRAPPERS: ReadonlySet<string> = new Set(EXPRESSION_WRAPPER_TYPES);

export function unwrapExpression(node: AstNode | null | undefined): AstNode | null | undefined {
  let current = node;
  while (current !== null && current !== undefined) {
    if (current.type === "ChainExpression") {
      current = current.expression;
      continue;
    }
    if (!EXPRESSION_WRAPPERS.has(current.type)) break;
    current = (current as ExpressionWrapperNode).expression;
  }
  return current;
}

export function memberName(node: AstNode | null | undefined): string | null {
  if (!node || (node.type !== "MemberExpression" && node.type !== "OptionalMemberExpression")) {
    return null;
  }
  if (!node.computed && node.property.type === "Identifier") {
    return node.property.name;
  }
  if (
    node.computed &&
    node.property.type === "Literal" &&
    typeof node.property.value === "string"
  ) {
    return node.property.value;
  }
  return null;
}

export function nodeStart(node: AstNode): number {
  if (Array.isArray(node.range)) return node.range[0];
  return "start" in node && typeof node.start === "number" ? node.start : 0;
}

export function staticString(node: AstNode | null | undefined): string | null {
  const value = unwrapExpression(node);
  if (value?.type === "Literal" && typeof value.value === "string") {
    return value.value;
  }
  if (value?.type === "TemplateLiteral" && value.expressions.length === 0) {
    return value.quasis[0]?.value.cooked ?? value.quasis[0]?.value.raw ?? null;
  }
  return null;
}

export function objectProperty(
  object: AstNode | null | undefined,
  name: string,
): AstProperty | null {
  const value = unwrapExpression(object);
  if (value?.type !== "ObjectExpression") return null;
  return (
    value.properties.findLast((property): property is AstProperty => {
      if (property.type !== "Property" || property.kind !== "init") return false;
      if (!property.computed && property.key.type === "Identifier") {
        return property.key.name === name;
      }
      return property.key.type === "Literal" && property.key.value === name;
    }) ?? null
  );
}
