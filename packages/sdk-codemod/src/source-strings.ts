import type { SgNode } from "@ast-grep/napi";

function isSyntaxOnlyNode(node: SgNode): boolean {
  const kind = node.kind();
  return (
    kind === "[" ||
    kind === "]" ||
    kind === "(" ||
    kind === ")" ||
    kind === "," ||
    kind === "comment"
  );
}

export function sourceArrayElements(node: SgNode): SgNode[] {
  return node.children().filter((child: SgNode) => !isSyntaxOnlyNode(child));
}

export function nodeRangeKey(node: SgNode): string {
  const range = node.range();
  return `${range.start.index}:${range.end.index}`;
}

export function sourceStringContent(node: SgNode, source: string): string | null {
  const kind = node.kind();
  if (kind !== "string" && kind !== "template_string") return null;
  if (
    kind === "template_string" &&
    node.children().some((child: SgNode) => child.kind() === "template_substitution")
  ) {
    return null;
  }
  const range = node.range();
  return source.slice(range.start.index + 1, range.end.index - 1);
}

export function sourceStaticStringContent(node: SgNode, source: string): string | null {
  return (
    sourceStringContent(node, source) ??
    (node.kind() === "identifier" ? sourceScopedStringVariableContent(node, source) : null)
  );
}

function sourceScopedStringVariableContent(identifier: SgNode, source: string): string | null {
  const name = identifier.text();
  const before = identifier.range().start.index;
  let current = identifier.parent();
  while (current != null) {
    if (isSourceScopeNode(current)) {
      const value = findSourceStringVariableInScope(current, name, before, source);
      if (value != null) return value;
    }
    current = current.parent();
  }
  return null;
}

function findSourceStringVariableInScope(
  scope: SgNode,
  name: string,
  before: number,
  source: string,
): string | null {
  let value: string | null = null;
  const visit = (node: SgNode): void => {
    if (node !== scope && isSourceScopeNode(node)) return;
    if (node.kind() === "variable_declarator" && node.range().end.index < before) {
      const declarationValue = sourceStringVariableDeclarationValue(node, name, source);
      if (declarationValue != null) value = declarationValue;
      return;
    }
    for (const child of node.children()) {
      visit(child);
    }
  };
  visit(scope);
  return value;
}

function sourceStringVariableDeclarationValue(
  node: SgNode,
  name: string,
  source: string,
): string | null {
  if (!isConstVariableDeclarator(node)) return null;
  const children = node.children();
  const identifier = children.find((child) => child.kind() === "identifier");
  if (identifier?.text() !== name) return null;
  const initializer = children.findLast(
    (child) => sourceConstInitializerContent(child, source) != null,
  );
  return initializer == null ? null : sourceConstInitializerContent(initializer, source);
}

function sourceConstInitializerContent(node: SgNode, source: string): string | null {
  const directValue = sourceStringContent(node, source);
  if (directValue != null) return directValue;
  if (
    node.kind() !== "as_expression" &&
    node.kind() !== "satisfies_expression" &&
    node.kind() !== "parenthesized_expression"
  ) {
    return null;
  }
  for (const child of node.children()) {
    const childValue = sourceConstInitializerContent(child, source);
    if (childValue != null) return childValue;
  }
  return null;
}

function isConstVariableDeclarator(node: SgNode): boolean {
  return (
    node
      .parent()
      ?.children()
      .some((child) => child.kind() === "const") ?? false
  );
}

function isSourceScopeNode(node: SgNode): boolean {
  const kind = node.kind();
  return (
    kind === "program" ||
    kind === "statement_block" ||
    kind === "function_declaration" ||
    kind === "arrow_function" ||
    kind === "method_definition"
  );
}
