import { parseSync } from "oxc-parser";
import type { Node, VariableDeclaration } from "@oxc-project/types";

/**
 * Extract the static key set returned by a record-level hook function.
 *
 * Supported shapes:
 *   - Arrow with expression body: `(...) => ({ key1, key2 })`
 *   - Arrow with block body containing a single `return { ... }` statement
 *   - Function expression / method shorthand with a single `return { ... }`
 *
 * The returned object literal must use static property names (identifiers or
 * string literals). Spread elements, computed keys, branched returns, and
 * non-object return values throw a clear error so the user can refactor.
 * @param fnSource - Stringified function source.
 * @returns Set of override keys (insertion order preserved).
 */
export function extractRecordHookOverrideKeys(fnSource: string): string[] {
  const { program } = parseSync("_.ts", `const __fn = ${fnSource};`);

  const declarator = (program.body[0] as VariableDeclaration | undefined)?.declarations[0];
  const fnNode = declarator?.init;
  if (!fnNode) {
    throw new Error(`Failed to parse record-level hook function: ${fnSource}`);
  }

  let returnExpr: Node | null | undefined;

  if (fnNode.type === "ArrowFunctionExpression") {
    if (fnNode.body.type !== "BlockStatement") {
      returnExpr = fnNode.body;
    } else {
      returnExpr = findSingleReturnExpression(fnNode.body.body);
    }
  } else if (fnNode.type === "FunctionExpression") {
    returnExpr = findSingleReturnExpression(fnNode.body?.body ?? []);
  } else {
    throw new Error(
      `Record-level hook must be a function expression or arrow function. Got: ${fnNode.type}`,
    );
  }

  // `({ ... })` parses as ParenthesizedExpression wrapping an ObjectExpression; unwrap.
  while (returnExpr && returnExpr.type === "ParenthesizedExpression") {
    returnExpr = (returnExpr as unknown as { expression: Node }).expression;
  }

  if (!returnExpr) {
    throw new Error(
      "Record-level hook must return a single object literal at the top level. " +
        "Refactor the function so its body is `({ ... })` or `return { ... }` with no branches.\n" +
        `  hook: ${fnSource}`,
    );
  }

  if (returnExpr.type !== "ObjectExpression") {
    throw new Error(
      "Record-level hook must return an object literal so override keys can be inferred. " +
        `Got: ${returnExpr.type}.\n  hook: ${fnSource}`,
    );
  }

  const keys: string[] = [];
  for (const prop of returnExpr.properties) {
    if (prop.type === "SpreadElement") {
      throw new Error(
        "Record-level hook return literal cannot use spread (`...rest`); list overridden keys explicitly.\n" +
          `  hook: ${fnSource}`,
      );
    }
    if (prop.computed) {
      throw new Error(
        "Record-level hook return literal cannot use computed keys (`[expr]: ...`); use plain identifiers.\n" +
          `  hook: ${fnSource}`,
      );
    }
    const key = prop.key;
    if (key.type === "Identifier") {
      keys.push(key.name);
    } else if (key.type === "Literal" && typeof key.value === "string") {
      keys.push(key.value);
    } else {
      throw new Error(
        `Record-level hook return literal has an unsupported key type "${key.type}".\n` +
          `  hook: ${fnSource}`,
      );
    }
  }
  return keys;
}

function findSingleReturnExpression(body: Node[]): Node | null {
  // Any return nested inside an `if`/loop/switch/try would be conditional, and
  // we cannot infer a single static set of override keys from a branched
  // function. Reject the whole shape upfront so the caller surfaces a clear
  // error instead of silently materializing keys from the unconditional return
  // alone.
  for (const stmt of body) {
    if (stmt.type !== "ReturnStatement" && containsReturnStatement(stmt)) {
      return null;
    }
  }

  let found: Node | null = null;
  for (const stmt of body) {
    if (stmt.type === "ReturnStatement") {
      if (found) return null;
      found = (stmt as unknown as { argument: Node | null }).argument;
    }
  }
  return found;
}

function containsReturnStatement(node: Node): boolean {
  // Nested functions have their own return semantics — do not descend into
  // them when scanning for the outer function's returns.
  if (
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionExpression" ||
    node.type === "FunctionDeclaration"
  ) {
    return false;
  }

  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end" || key === "loc") continue;
    const value = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item) && (item.type === "ReturnStatement" || containsReturnStatement(item))) {
          return true;
        }
      }
    } else if (isNode(value)) {
      if (value.type === "ReturnStatement" || containsReturnStatement(value)) {
        return true;
      }
    }
  }
  return false;
}

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && "type" in value;
}
