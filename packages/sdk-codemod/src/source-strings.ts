import type { SgNode, SgRoot } from "@ast-grep/napi";

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

type SourceStringDeclarations = Map<string, Array<{ end: number; value: string }>>;

const sourceStringDeclarationsByTree = new WeakMap<SgRoot, Map<number, SourceStringDeclarations>>();

function findSourceStringVariableInScope(
  scope: SgNode,
  name: string,
  before: number,
  source: string,
): string | null {
  const declarations = sourceStringDeclarationsInScope(scope, source).get(name);
  return declarations?.findLast((declaration) => declaration.end < before)?.value ?? null;
}

function sourceStringDeclarationsInScope(scope: SgNode, source: string): SourceStringDeclarations {
  const tree = scope.getRoot();
  let scopes = sourceStringDeclarationsByTree.get(tree);
  if (!scopes) {
    scopes = new Map();
    sourceStringDeclarationsByTree.set(tree, scopes);
  }
  let declarations = scopes.get(scope.id());
  if (!declarations) {
    declarations = collectSourceStringDeclarations(scope, source);
    scopes.set(scope.id(), declarations);
  }
  return declarations;
}

function collectSourceStringDeclarations(scope: SgNode, source: string): SourceStringDeclarations {
  const declarations: SourceStringDeclarations = new Map();
  const visit = (node: SgNode, isConst: boolean): void => {
    if (node !== scope && isSourceScopeNode(node)) return;
    if (isConst && node.kind() === "variable_declarator") {
      const declaration = sourceStringVariableDeclaration(node, source);
      if (declaration != null) {
        const named = declarations.get(declaration.name) ?? [];
        named.push({ end: node.range().end.index, value: declaration.value });
        declarations.set(declaration.name, named);
      }
    }
    const children = node.children();
    const declaresConst = children.some((child) => child.kind() === "const");
    for (const child of children) {
      visit(child, declaresConst);
    }
  };
  visit(scope, false);
  return declarations;
}

function sourceStringVariableDeclaration(
  node: SgNode,
  source: string,
): { name: string; value: string } | null {
  const children = node.children();
  const identifier = children.find((child) => child.kind() === "identifier");
  if (identifier == null) return null;
  const initializer = children.findLast(
    (child) => sourceConstInitializerContent(child, source) != null,
  );
  const value = initializer == null ? null : sourceConstInitializerContent(initializer, source);
  return value == null ? null : { name: identifier.text(), value };
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
