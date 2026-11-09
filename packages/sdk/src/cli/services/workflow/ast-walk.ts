import type { ASTNode } from "./ast-utils";

type AstVisitor = (node: ASTNode, parents: readonly ASTNode[]) => void;

/**
 * Visit AST objects in preorder, with ancestors ordered from outermost to nearest.
 * @param root - Parsed AST root
 * @param visit - Visitor receiving the node and its ancestors
 */
export function walkAst(root: unknown, visit: AstVisitor): void {
  function walk(value: unknown, parents: readonly ASTNode[]): void {
    if (!value || typeof value !== "object") return;
    const node = value as ASTNode;
    visit(node, parents);
    const newParents = [...parents, node];
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (Array.isArray(child)) {
        child.forEach((item: unknown) => walk(item, newParents));
      } else if (child && typeof child === "object") {
        walk(child, newParents);
      }
    }
  }
  walk(root, []);
}
