import { parseSync } from "oxc-parser";
import { ES_BUILTINS } from "#/utils/es-builtins";
import type { BindingPattern, Node, ParamPattern } from "@oxc-project/types";

/** Fields that contain TypeScript type annotations (not runtime references). */
export const TS_TYPE_FIELDS = new Set([
  "typeAnnotation",
  "typeParameters",
  "returnType",
  "superTypeArguments",
  "typeArguments",
]);

/**
 * Recursively extract binding names from a destructuring pattern node.
 * @param pattern - The binding pattern AST node.
 * @param bindings - Set to collect binding names into.
 */
function collectBindingsFromPattern(pattern: BindingPattern, bindings: Set<string>): void {
  switch (pattern.type) {
    case "Identifier":
      bindings.add(pattern.name);
      break;
    case "ObjectPattern":
      for (const prop of pattern.properties) {
        if (prop.type === "RestElement") {
          collectBindingsFromPattern(prop.argument, bindings);
        } else {
          collectBindingsFromPattern(prop.value, bindings);
        }
      }
      break;
    case "ArrayPattern":
      for (const elem of pattern.elements) {
        if (elem) {
          if (elem.type === "RestElement") {
            collectBindingsFromPattern(elem.argument, bindings);
          } else {
            collectBindingsFromPattern(elem, bindings);
          }
        }
      }
      break;
    case "AssignmentPattern":
      collectBindingsFromPattern(pattern.left, bindings);
      break;
  }
}

function isBindingPattern(param: ParamPattern): param is BindingPattern {
  return param.type !== "TSParameterProperty";
}

const EQUALITY_OPERATORS = new Set(["===", "!==", "==", "!="]);

/**
 * If `expr` is a `typeof x === "..."` / `typeof x !== "..."` comparison, return
 * the guarded identifier's name. `typeof` never throws on an undeclared
 * identifier, so code gated by this comparison (e.g. `typeof x === "object" &&
 * x`, the cross-environment global-detection idiom used by es-toolkit, lodash,
 * core-js, etc.) cannot actually reference `x` when it is undeclared. Loose
 * equality (`==`/`!=`) is included because minifiers rewrite `===`/`!==`
 * against a `typeof` result to the loose form (the result is always a string,
 * so the two are equivalent there).
 * @param expr - Candidate comparison AST node.
 * @returns The guarded identifier's name, or undefined if `expr` doesn't match.
 */
function typeofGuardTarget(expr: Node): string | undefined {
  if (expr.type !== "BinaryExpression") return undefined;
  if (!EQUALITY_OPERATORS.has(expr.operator)) return undefined;
  for (const side of [expr.left, expr.right]) {
    if (
      side.type === "UnaryExpression" &&
      side.operator === "typeof" &&
      side.argument.type === "Identifier"
    ) {
      return side.argument.name;
    }
  }
  return undefined;
}

/**
 * Parse a code string with oxc-parser and return identifiers that are referenced
 * but never bound anywhere in the snippet (free variables), excluding ES builtins.
 * @param code - Valid JavaScript code to analyze.
 * @returns Set of undefined variable names.
 */
export function findUndefinedReferences(code: string): Set<string> {
  const { program, errors } = parseSync("_.js", code);
  if (errors.length > 0) {
    const details = errors.map((error) => `  - ${error.message}`).join("\n");
    throw new Error(`Failed to parse code for free-variable analysis.\nParse errors:\n${details}`);
  }
  const references = new Set<string>();
  const bindings = new Set<string>();

  const walk = (node: Node | null | undefined): void => {
    if (!node) return;

    switch (node.type) {
      case "VariableDeclarator":
        collectBindingsFromPattern(node.id, bindings);
        walk(node.init);
        return;

      case "FunctionDeclaration":
      case "FunctionExpression":
        if (node.id) bindings.add(node.id.name);
        for (const param of node.params) {
          if (isBindingPattern(param)) {
            collectBindingsFromPattern(param, bindings);
            walk(param);
          }
        }
        walk(node.body);
        return;

      case "ArrowFunctionExpression":
        for (const param of node.params) {
          if (isBindingPattern(param)) {
            collectBindingsFromPattern(param, bindings);
            walk(param);
          }
        }
        walk(node.body);
        return;

      case "ClassDeclaration":
      case "ClassExpression":
        if (node.id) bindings.add(node.id.name);
        walk(node.superClass);
        walk(node.body);
        return;

      case "CatchClause":
        if (node.param) collectBindingsFromPattern(node.param, bindings);
        walk(node.body);
        return;

      case "MemberExpression":
        walk(node.object);
        if (node.computed) walk(node.property);
        return;

      case "UnaryExpression":
        if (node.operator === "typeof" && node.argument.type === "Identifier") {
          return;
        }
        walk(node.argument);
        return;

      case "LogicalExpression": {
        const guardedName = node.operator === "&&" ? typeofGuardTarget(node.left) : undefined;
        walk(node.left);
        if (guardedName && node.right.type === "Identifier" && node.right.name === guardedName) {
          return;
        }
        walk(node.right);
        return;
      }

      case "Property":
        if (node.computed) walk(node.key);
        walk(node.value);
        return;

      case "LabeledStatement":
        walk(node.body);
        return;

      case "Identifier":
        references.add(node.name);
        return;

      default:
        break;
    }

    // Generic child walk for all other node types, skipping TS type-annotation fields
    const rec = node as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(rec)) {
      if (key === "type" || TS_TYPE_FIELDS.has(key)) continue;
      if (Array.isArray(value)) {
        for (const item of value) walk(item as Node);
      } else if (value && typeof value === "object" && "type" in value) {
        walk(value as Node);
      }
    }
  };

  walk(program);

  // Free variables = references - bindings - builtins
  const freeVars = new Set<string>();
  for (const ref of references) {
    if (!bindings.has(ref) && !ES_BUILTINS.has(ref)) {
      freeVars.add(ref);
    }
  }
  return freeVars;
}
