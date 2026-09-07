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
export type AstProperty = Extract<EstreeNode, { type: "Property" }>;

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

function nodeType(node: AstNode | null | undefined): string | undefined {
  return node?.type;
}

export function parentOf(node: AstNode | null | undefined): AstNode | null {
  return (node as { parent?: AstNode } | null | undefined)?.parent ?? null;
}

export function isValueReference(node: AstIdentifier): boolean {
  const parent = parentOf(node);
  // `declare global {}` / `declare module "x" {}` name the augmented scope.
  if (nodeType(parent) === "TSModuleDeclaration") return false;
  switch (parent?.type) {
    case "ImportSpecifier":
    case "ImportDefaultSpecifier":
    case "ImportNamespaceSpecifier":
    case "LabeledStatement":
    case "BreakStatement":
    case "ContinueStatement":
      return false;
    case "MemberExpression":
    case "OptionalMemberExpression":
      return parent.object === node || parent.computed;
    case "Property":
      return parent.value === node || parent.computed;
    case "MethodDefinition":
    case "PropertyDefinition":
      return parent.key !== node || parent.computed;
    case "VariableDeclarator":
      return parent.id !== node;
    case "FunctionDeclaration":
    case "ClassDeclaration":
      return parent.id !== node;

    default:
      return true;
  }
}

const TYPE_NODE_TYPES: ReadonlySet<string> = new Set([
  "TSClassImplements",
  "TSDeclareFunction",
  "TSIndexSignature",
  "TSInterfaceDeclaration",
  "TSInterfaceHeritage",
  "TSMethodSignature",
  "TSPropertySignature",
  "TSQualifiedName",
  "TSTypeAliasDeclaration",
  "TSTypeAnnotation",
  "TSTypeLiteral",
  "TSTypeParameterDeclaration",
  "TSTypeParameterInstantiation",
  "TSTypePredicate",
  "TSTypeQuery",
  "TSTypeReference",
]);

export function isTypePosition(node: AstNode): boolean {
  for (let current = parentOf(node); current !== null; current = parentOf(current)) {
    if (TYPE_NODE_TYPES.has(current.type)) return true;
  }
  return false;
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

/** The object's properties when every one is a plain, non-computed property; null otherwise. */
export function literalProperties(node: AstNode | null | undefined): AstProperty[] | null {
  const value = unwrapExpression(node);
  if (value?.type !== "ObjectExpression") return null;
  const properties: AstProperty[] = [];
  for (const property of value.properties) {
    if (property.type !== "Property" || property.computed) return null;
    properties.push(property);
  }
  return properties;
}

/** The array's elements when none is a spread or a hole; null otherwise. */
export function literalElements(node: AstNode | null | undefined): AstNode[] | null {
  const value = unwrapExpression(node);
  if (value?.type !== "ArrayExpression") return null;
  const elements: AstNode[] = [];
  for (const element of value.elements) {
    if (element === null || element.type === "SpreadElement") return null;
    elements.push(element);
  }
  return elements;
}

export function propertyName(property: AstProperty): string | null {
  if (property.computed) return null;
  if (property.key.type === "Identifier") return property.key.name;
  return property.key.type === "Literal" && typeof property.key.value === "string"
    ? property.key.value
    : null;
}

type AstReturnStatement = Extract<EstreeNode, { type: "ReturnStatement" }>;
type AstStatement = Extract<EstreeNode, { type: "BlockStatement" }>["body"][number];

/** Every `return` in a block, skipping nested functions' own returns. */
export function returnStatements(block: AstNode): AstReturnStatement[] {
  if (block.type !== "BlockStatement") return [];
  const returns: AstReturnStatement[] = [];
  const visitStatement = (statement: AstStatement): void => {
    switch (statement.type) {
      case "ReturnStatement":
        returns.push(statement);
        return;
      case "BlockStatement":
        for (const child of statement.body) visitStatement(child);
        return;
      case "IfStatement":
        visitStatement(statement.consequent);
        if (statement.alternate) visitStatement(statement.alternate);
        return;
      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement":
      case "WhileStatement":
      case "DoWhileStatement":
      case "LabeledStatement":
        visitStatement(statement.body);
        return;
      case "TryStatement":
        visitStatement(statement.block);
        if (statement.handler) visitStatement(statement.handler.body);
        if (statement.finalizer) visitStatement(statement.finalizer);
        return;
      case "SwitchStatement":
        for (const switchCase of statement.cases) {
          for (const child of switchCase.consequent) visitStatement(child);
        }
        return;
      default:
        return;
    }
  };
  for (const statement of block.body) visitStatement(statement);
  return returns;
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
