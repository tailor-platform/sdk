import type {
  Expression,
  AwaitExpression,
  ImportExpression,
  CallExpression,
  ObjectPropertyKind,
  ObjectProperty,
  ArrowFunctionExpression,
  Function as FunctionExpression,
} from "@oxc-project/types";

/** A generic AST node for walking purposes */
export type ASTNode = Record<string, unknown>;

export interface Replacement {
  start: number;
  end: number;
  text: string;
}

export interface FoundProperty {
  key: ObjectProperty["key"];
  value: Expression;
  start: number;
  end: number;
}

/**
 * Check if a module source is from \@tailor-platform/sdk (including subpaths)
 */
export function isTailorSdkSource(source: string): boolean {
  return /^@tailor-platform\/sdk(\/|$)/.test(source);
}

/**
 * Get the source string from a dynamic import or require call
 */
export function getImportSource(node: Expression | null | undefined): string | null {
  if (!node) return null;
  // await import("@tailor-platform/sdk")
  if (node.type === "ImportExpression") {
    const importExpr = node as ImportExpression;
    const source = importExpr.source;
    if (source.type === "Literal" && typeof source.value === "string") {
      return source.value;
    }
  }
  // require("@tailor-platform/sdk")
  if (node.type === "CallExpression") {
    const callExpr = node as CallExpression;
    if (callExpr.callee.type === "Identifier" && callExpr.callee.name === "require") {
      const arg = callExpr.arguments[0];
      if (
        arg &&
        "type" in arg &&
        arg.type === "Literal" &&
        "value" in arg &&
        typeof arg.value === "string"
      ) {
        return arg.value;
      }
    }
  }
  return null;
}

/**
 * Unwrap AwaitExpression to get the inner expression
 */
export function unwrapAwait(node: Expression | null | undefined): Expression | null | undefined {
  if (node?.type === "AwaitExpression") {
    return (node as AwaitExpression).argument;
  }
  return node;
}

/**
 * Check if a node is a string literal
 */
export function isStringLiteral(
  node: Expression | null | undefined,
): node is Expression & { type: "Literal"; value: string } {
  // Note: oxc uses "Literal" for all literals, distinguishing by value type
  return node?.type === "Literal" && typeof (node as { value?: unknown }).value === "string";
}

/**
 * Check if a node is a function expression (arrow or regular)
 */
export function isFunctionExpression(
  node: Expression | null | undefined,
): node is ArrowFunctionExpression | FunctionExpression {
  return node?.type === "ArrowFunctionExpression" || node?.type === "FunctionExpression";
}

/**
 * Find a property in an object expression
 */
export function findProperty(properties: ObjectPropertyKind[], name: string): FoundProperty | null {
  for (const prop of properties) {
    // Note: oxc uses "Property" for object properties
    if (prop.type === "Property") {
      const objProp = prop as ObjectProperty;
      const keyName =
        objProp.key.type === "Identifier"
          ? objProp.key.name
          : objProp.key.type === "Literal"
            ? (objProp.key as { value?: string }).value
            : null;
      if (keyName === name) {
        return {
          key: objProp.key,
          value: objProp.value,
          start: objProp.start,
          end: objProp.end,
        };
      }
    }
  }
  return null;
}

/**
 * Apply string replacements to source code
 * Replacements are applied from end to start to maintain positions
 */
export function applyReplacements(source: string, replacements: Replacement[]): string {
  const sorted = [...replacements].sort((a, b) => b.start - a.start);
  let result = source;
  for (const r of sorted) {
    result = result.slice(0, r.start) + r.text + result.slice(r.end);
  }
  return result;
}

/**
 * Find the end of a statement including any trailing newline
 */
export function findStatementEnd(source: string, position: number): number {
  let i = position;
  // Skip any trailing semicolons and whitespace on the same line
  while (i < source.length && (source[i] === ";" || source[i] === " " || source[i] === "\t")) {
    i++;
  }
  // Include the newline if present
  if (i < source.length && source[i] === "\n") {
    i++;
  }
  return i;
}

/**
 * Walk through all AST nodes and invoke callback for each node
 */
export function walkASTNodes(
  node: ASTNode | null | undefined,
  callback: (node: ASTNode, parents: ASTNode[]) => void,
  parents: ASTNode[] = [],
): void {
  if (!node || typeof node !== "object") return;

  callback(node, parents);

  const newParents = [...parents, node];
  for (const key of Object.keys(node)) {
    const child = node[key] as unknown;
    if (Array.isArray(child)) {
      child.forEach((c: unknown) => walkASTNodes(c as ASTNode | null, callback, newParents));
    } else if (child && typeof child === "object") {
      walkASTNodes(child as ASTNode, callback, newParents);
    }
  }
}

/**
 * Resolve a relative path from a base directory
 * Simple implementation that handles ./ and ../ prefixes
 */
export function resolvePath(baseDir: string, relativePath: string): string {
  // Normalize separators to forward slash
  const normalized = relativePath.replace(/\\/g, "/");

  // Split into parts
  const parts = normalized.split("/");
  const baseParts = baseDir.replace(/\\/g, "/").split("/");

  for (const part of parts) {
    if (part === ".") {
      // Current directory, do nothing
    } else if (part === "..") {
      // Go up one directory
      baseParts.pop();
    } else {
      // Add the part
      baseParts.push(part);
    }
  }

  return baseParts.join("/");
}
