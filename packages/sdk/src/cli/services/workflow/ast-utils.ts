import { assertDefined } from "#/utils/assert";
import type {
  Expression,
  AwaitExpression,
  ImportExpression,
  CallExpression,
  StaticMemberExpression,
  IdentifierReference,
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

export interface TriggerCallInfo {
  identifierName: string;
  callRange: { start: number; end: number };
  argsText: string;
  optionsText?: string;
}

export interface FoundProperty {
  key: ObjectProperty["key"];
  value: Expression;
  start: number;
  end: number;
}

/**
 * Check if a module source is from the Tailor SDK package (including subpaths)
 * @param source - Module source string
 * @returns True if the source is from the Tailor SDK package
 */
export function isTailorSdkSource(source: string): boolean {
  return /^@tailor-platform\/sdk(\/|$)/.test(source);
}

/**
 * Get the source string from a dynamic import or require call
 * @param node - AST node to inspect
 * @returns Resolved import/require source string or null
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
        // callee may be a ComputedMemberExpression at runtime
        // oxlint-disable-next-line typescript/no-unnecessary-condition
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

function argumentSourceText(arg: unknown, sourceText: string): string | undefined {
  if (arg && typeof arg === "object" && "start" in arg && "end" in arg) {
    return sourceText.slice(arg.start as number, arg.end as number);
  }
  return undefined;
}

/**
 * Get metadata for a static `identifier.trigger(...)` call.
 * @param node - AST node to inspect
 * @param sourceText - Source code text
 * @returns Trigger call metadata, or null when the node is not a trigger call
 */
export function getTriggerCallInfo(
  node: ASTNode | null | undefined,
  sourceText: string,
): TriggerCallInfo | null {
  if (!node || typeof node !== "object" || node.type !== "CallExpression") {
    return null;
  }

  const callExpr = node as unknown as CallExpression;
  const callee = callExpr.callee;
  if (callee.type !== "MemberExpression") {
    return null;
  }

  const memberExpr = callee as unknown as StaticMemberExpression;
  if (
    // callee may be a ComputedMemberExpression at runtime
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    memberExpr.computed ||
    memberExpr.object.type !== "Identifier" ||
    memberExpr.property.name !== "trigger"
  ) {
    return null;
  }

  return {
    identifierName: (memberExpr.object as IdentifierReference).name,
    callRange: { start: callExpr.start, end: callExpr.end },
    argsText: argumentSourceText(callExpr.arguments[0], sourceText) ?? "",
    optionsText: argumentSourceText(callExpr.arguments[1], sourceText),
  };
}

/**
 * Unwrap AwaitExpression to get the inner expression
 * @param node - AST expression node
 * @returns Inner expression if node is an AwaitExpression
 */
export function unwrapAwait(node: Expression | null | undefined): Expression | null | undefined {
  if (node?.type === "AwaitExpression") {
    return (node as AwaitExpression).argument;
  }
  return node;
}

/**
 * Check if a node is a string literal
 * @param node - AST expression node
 * @returns True if node is a string literal
 */
export function isStringLiteral(
  node: Expression | null | undefined,
): node is Expression & { type: "Literal"; value: string } {
  // Note: oxc uses "Literal" for all literals, distinguishing by value type
  return node?.type === "Literal" && typeof (node as { value?: unknown }).value === "string";
}

/**
 * Check if a node is a function expression (arrow or regular)
 * @param node - AST expression node
 * @returns True if node is a function expression
 */
export function isFunctionExpression(
  node: Expression | null | undefined,
): node is ArrowFunctionExpression | FunctionExpression {
  return node?.type === "ArrowFunctionExpression" || node?.type === "FunctionExpression";
}

/**
 * Find a property in an object expression
 * @param properties - Object properties to search
 * @param name - Property name to find
 * @returns Found property info or null
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
 * Ranges must not overlap; applying an overlapping range on top of an
 * already-shifted string would splice at stale offsets and corrupt the output,
 * so overlap is rejected up front
 * @param source - Original source code
 * @param replacements - Replacements to apply
 * @returns Transformed source code
 */
export function applyReplacements(source: string, replacements: Replacement[]): string {
  const sorted = replacements.toSorted((a, b) => b.start - a.start);
  for (let i = 0; i + 1 < sorted.length; i++) {
    const current = assertDefined(sorted[i], `replacement missing at index ${i}`);
    const previous = assertDefined(sorted[i + 1], `replacement missing at index ${i + 1}`);
    if (previous.end > current.start) {
      throw new Error(
        `applyReplacements: overlapping replacement ranges ` +
          `[${previous.start}, ${previous.end}) and [${current.start}, ${current.end})`,
      );
    }
  }
  let result = source;
  for (const r of sorted) {
    result = result.slice(0, r.start) + r.text + result.slice(r.end);
  }
  return result;
}

/**
 * Find the end of a statement including any trailing newline
 * @param source - Source code
 * @param position - Start position of the statement
 * @returns Index of the end of the statement including trailing newline
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
 * Resolve a relative path from a base directory
 * Simple implementation that handles ./ and ../ prefixes
 * @param baseDir - Base directory
 * @param relativePath - Relative path to resolve
 * @returns Resolved absolute path
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
