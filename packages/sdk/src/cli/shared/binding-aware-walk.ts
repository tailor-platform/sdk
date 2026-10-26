import type { ASTNode } from "#/cli/services/workflow/ast-utils";
import type { Program } from "@oxc-project/types";

function collectBindingNames(node: ASTNode | null | undefined, names: Set<string>): void {
  if (!node || typeof node !== "object") return;

  switch (node.type) {
    case "Identifier":
      names.add(node.name as string);
      return;
    case "ObjectPattern":
      for (const property of node.properties as ASTNode[]) {
        collectBindingNames(
          property.type === "RestElement"
            ? (property.argument as ASTNode)
            : (property.value as ASTNode),
          names,
        );
      }
      return;
    case "ArrayPattern":
      for (const element of node.elements as Array<ASTNode | null>) {
        collectBindingNames(element, names);
      }
      return;
    case "AssignmentPattern":
      collectBindingNames(node.left as ASTNode, names);
      return;
    case "RestElement":
      collectBindingNames(node.argument as ASTNode, names);
      return;
    case "TSParameterProperty":
      collectBindingNames(node.parameter as ASTNode, names);
  }
}

function declarationNode(statement: ASTNode): ASTNode | undefined {
  return statement.type === "ExportNamedDeclaration" ||
    statement.type === "ExportDefaultDeclaration"
    ? (statement.declaration as ASTNode | undefined)
    : statement;
}

function collectBlockBindings(statements: ASTNode[], names: Set<string>): void {
  for (const statement of statements) {
    const declaration = declarationNode(statement);
    if (!declaration) continue;

    if (declaration.type === "VariableDeclaration") {
      if (declaration.kind === "var") continue;
      for (const declarator of declaration.declarations as ASTNode[]) {
        collectBindingNames(declarator.id as ASTNode, names);
      }
    } else if (
      declaration.type === "FunctionDeclaration" ||
      declaration.type === "ClassDeclaration" ||
      declaration.type === "TSEnumDeclaration" ||
      declaration.type === "TSModuleDeclaration" ||
      declaration.type === "TSImportEqualsDeclaration"
    ) {
      collectBindingNames(declaration.id as ASTNode | undefined, names);
    }
  }
}

function collectFunctionVarBindings(root: ASTNode, names: Set<string>): void {
  function walk(node: ASTNode | null | undefined): void {
    if (!node || typeof node !== "object") return;
    if (
      node !== root &&
      (node.type === "FunctionDeclaration" ||
        node.type === "FunctionExpression" ||
        node.type === "ArrowFunctionExpression" ||
        node.type === "StaticBlock")
    ) {
      return;
    }
    if (node.type === "VariableDeclaration" && node.kind === "var") {
      for (const declarator of node.declarations as ASTNode[]) {
        collectBindingNames(declarator.id as ASTNode, names);
      }
    }
    for (const key of Object.keys(node)) {
      if (key === "parent") continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) walk(item as ASTNode | null);
      } else if (child && typeof child === "object") {
        walk(child as ASTNode);
      }
    }
  }

  walk(root);
}

function collectScopeBindings(node: ASTNode): Set<string> | undefined {
  const names = new Set<string>();

  if (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  ) {
    collectBindingNames(node.id as ASTNode | undefined, names);
    for (const parameter of node.params as ASTNode[]) {
      collectBindingNames(parameter, names);
    }
    collectFunctionVarBindings(node, names);
    return names;
  }

  if (node.type === "BlockStatement") {
    collectBlockBindings(node.body as ASTNode[], names);
    return names;
  }

  if (node.type === "StaticBlock" || node.type === "TSModuleBlock") {
    collectBlockBindings(node.body as ASTNode[], names);
    collectFunctionVarBindings(node, names);
    return names;
  }

  if (node.type === "SwitchStatement") {
    const cases = node.cases as ASTNode[];
    collectBlockBindings(
      cases.flatMap((switchCase) => switchCase.consequent as ASTNode[]),
      names,
    );
    return names;
  }

  if (node.type === "ClassExpression") {
    collectBindingNames(node.id as ASTNode | undefined, names);
    return names;
  }

  if (node.type === "CatchClause") {
    collectBindingNames(node.param as ASTNode | undefined, names);
    return names;
  }

  if (
    node.type === "ForStatement" ||
    node.type === "ForInStatement" ||
    node.type === "ForOfStatement"
  ) {
    const declaration = (node.init ?? node.left) as ASTNode | undefined;
    if (declaration?.type === "VariableDeclaration" && declaration.kind !== "var") {
      for (const declarator of declaration.declarations as ASTNode[]) {
        collectBindingNames(declarator.id as ASTNode, names);
      }
    }
    return names;
  }

  return undefined;
}

function addShadowedBindings(
  shadowedNames: ReadonlySet<string>,
  bindings: Set<string> | undefined,
  targetNames: ReadonlySet<string>,
): ReadonlySet<string> {
  if (!bindings) return shadowedNames;
  const relevantBindings = [...bindings].filter((name) => targetNames.has(name));
  return relevantBindings.length === 0
    ? shadowedNames
    : new Set([...shadowedNames, ...relevantBindings]);
}

/**
 * Visit every node outside import declarations, passing the target names that
 * a local binding shadows at that node.
 * @param program - Parsed module
 * @param targetNames - Module-level names to track shadowing for
 * @param visitor - Called for each node with the shadowed target names, its parent, and the parent key holding it
 */
export function walkBindingAware(
  program: Program,
  targetNames: ReadonlySet<string>,
  visitor: (
    node: ASTNode,
    shadowedNames: ReadonlySet<string>,
    parentNode?: ASTNode,
    parentKey?: string,
  ) => void,
): void {
  function walk(
    node: ASTNode | null | undefined,
    shadowedNames: ReadonlySet<string>,
    parentNode?: ASTNode,
    parentKey?: string,
  ): void {
    if (!node || typeof node !== "object" || node.type === "ImportDeclaration") return;

    const nestedShadowedNames =
      node.type === "Program"
        ? shadowedNames
        : addShadowedBindings(shadowedNames, collectScopeBindings(node), targetNames);
    visitor(node, nestedShadowedNames, parentNode, parentKey);

    for (const key of Object.keys(node)) {
      if (key === "parent") continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          walk(item as ASTNode | null, nestedShadowedNames, node, key);
        }
      } else if (child && typeof child === "object") {
        walk(child as ASTNode, nestedShadowedNames, node, key);
      }
    }
  }

  walk(program as unknown as ASTNode, new Set());
}
