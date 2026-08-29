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

/**
 * A function-scope boundary (function declaration/expression, arrow
 * function, or the module root). Declarations resolve within the scope they
 * are collected into; references are checked against this chain at the end,
 * once every scope's bindings have been fully collected. Block-level
 * scoping (`let`/`const`/`catch` shadowing within an `if`/`for`/`{}`) is not
 * modeled — such bindings are attached to their nearest enclosing function
 * scope, which is safe for detecting a forbidden global reachable from
 * outside the block but does not detect one shadowed only within it.
 */
interface Scope {
  bindings: Set<string>;
  parent: Scope | null;
}

function isBoundInScope(scope: Scope, name: string): boolean {
  for (let s: Scope | null = scope; s; s = s.parent) {
    if (s.bindings.has(name)) return true;
  }
  return false;
}

const NEGATIVE_EQUALITY_OPERATORS = new Set(["!==", "!="]);
const POSITIVE_EQUALITY_OPERATORS = new Set(["===", "=="]);

/**
 * Read the static string value of a string literal or a template literal with
 * no interpolated expressions (e.g. `` `object` ``, which minifiers use in
 * place of `"object"` — both are the same string at runtime).
 * @param node - Candidate literal AST node.
 * @returns The literal's string value, or undefined if `node` isn't one.
 */
function staticStringValue(node: Node): string | undefined {
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (
    node.type === "TemplateLiteral" &&
    node.expressions.length === 0 &&
    node.quasis.length === 1
  ) {
    return node.quasis[0]?.value.cooked ?? undefined;
  }
  return undefined;
}

/**
 * If `expr` is a `typeof x === "..."` / `typeof x !== "..."` comparison that
 * is only true while `x` is declared, return `x`'s name. `typeof` never
 * throws on an undeclared identifier, so `typeof x !== "undefined" && x` (and
 * `typeof x === "<anything but undefined>" && x`) cannot actually reference
 * `x` when it is undeclared — this is the cross-environment global-detection
 * idiom used by es-toolkit, lodash, core-js, etc. The opposite direction —
 * `typeof x === "undefined" && x` or `typeof x !== "<anything but
 * undefined>" && x` — is true precisely when `x` is NOT safely usable (or
 * says nothing about it), so it must not be treated as a guard. Loose
 * equality (`==`/`!=`) is included because minifiers rewrite `===`/`!==`
 * against a `typeof` result to the loose form (the result is always a
 * string, so the two are equivalent there).
 * @param expr - Candidate comparison AST node.
 * @returns The guarded identifier's name, or undefined if `expr` doesn't guard one.
 */
function typeofGuardTarget(expr: Node): string | undefined {
  if (expr.type !== "BinaryExpression") return undefined;
  const { left, right, operator } = expr;
  const [typeofSide, literalSide] =
    left.type === "UnaryExpression" &&
    left.operator === "typeof" &&
    left.argument.type === "Identifier"
      ? [left, right]
      : right.type === "UnaryExpression" &&
          right.operator === "typeof" &&
          right.argument.type === "Identifier"
        ? [right, left]
        : [undefined, undefined];
  if (!typeofSide) return undefined;
  const literalValue = staticStringValue(literalSide);
  if (literalValue === undefined) return undefined;
  const comparesToUndefined = literalValue === "undefined";
  const isSafe =
    (NEGATIVE_EQUALITY_OPERATORS.has(operator) && comparesToUndefined) ||
    (POSITIVE_EQUALITY_OPERATORS.has(operator) && !comparesToUndefined);
  if (!isSafe) return undefined;
  return (typeofSide.argument as { name: string }).name;
}

/**
 * Check whether `node` is `guardedName` itself, or a member-expression chain
 * rooted at it (`x.y`, `x.y[z]`), as in `typeof x !== "undefined" && x.y`.
 * Computed property expressions along the chain are still walked for their
 * own free variables (e.g. the `z` in `x.y[z]`) — only the guarded root
 * identifier is treated as safe.
 * @param node - Candidate right-hand side of a `typeof`-guarded `&&`.
 * @param guardedName - The identifier name the `typeof` check guards.
 * @param walk - The AST walker, used to visit computed property expressions.
 * @returns Whether `node` is entirely covered by the guard.
 */
function walkGuardedChain(
  node: Node,
  guardedName: string,
  walk: (n: Node | null | undefined) => void,
): boolean {
  if (node.type === "Identifier") {
    return node.name === guardedName;
  }
  if (node.type === "MemberExpression") {
    if (!walkGuardedChain(node.object, guardedName, walk)) return false;
    if (node.computed) walk(node.property);
    return true;
  }
  return false;
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
  const references: { name: string; scope: Scope }[] = [];
  const rootScope: Scope = { bindings: new Set(), parent: null };
  let currentScope: Scope = rootScope;

  const walk = (node: Node | null | undefined): void => {
    if (!node) return;

    switch (node.type) {
      case "VariableDeclarator":
        collectBindingsFromPattern(node.id, currentScope.bindings);
        walk(node.init);
        return;

      case "ImportDeclaration":
        for (const specifier of node.specifiers) {
          currentScope.bindings.add(specifier.local.name);
        }
        return;

      case "FunctionDeclaration":
      case "FunctionExpression": {
        if (node.type === "FunctionDeclaration" && node.id) {
          currentScope.bindings.add(node.id.name);
        }
        const functionScope: Scope = { bindings: new Set(), parent: currentScope };
        if (node.type === "FunctionExpression" && node.id) {
          functionScope.bindings.add(node.id.name);
        }
        for (const param of node.params) {
          if (isBindingPattern(param)) {
            collectBindingsFromPattern(param, functionScope.bindings);
          }
        }
        const outerScope = currentScope;
        currentScope = functionScope;
        for (const param of node.params) {
          if (isBindingPattern(param)) walk(param);
        }
        walk(node.body);
        currentScope = outerScope;
        return;
      }

      case "ArrowFunctionExpression": {
        const functionScope: Scope = { bindings: new Set(), parent: currentScope };
        for (const param of node.params) {
          if (isBindingPattern(param)) {
            collectBindingsFromPattern(param, functionScope.bindings);
          }
        }
        const outerScope = currentScope;
        currentScope = functionScope;
        for (const param of node.params) {
          if (isBindingPattern(param)) walk(param);
        }
        walk(node.body);
        currentScope = outerScope;
        return;
      }

      case "ClassDeclaration":
      case "ClassExpression":
        if (node.id) currentScope.bindings.add(node.id.name);
        walk(node.superClass);
        walk(node.body);
        return;

      case "CatchClause":
        if (node.param) collectBindingsFromPattern(node.param, currentScope.bindings);
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
        if (guardedName && walkGuardedChain(node.right, guardedName, walk)) {
          return;
        }
        walk(node.right);
        return;
      }

      case "Property":
        if (node.computed) walk(node.key);
        walk(node.value);
        return;

      case "MethodDefinition":
      case "TSAbstractMethodDefinition":
      case "PropertyDefinition":
      case "TSAbstractPropertyDefinition":
      case "AccessorProperty":
      case "TSAbstractAccessorProperty":
        for (const decorator of node.decorators) walk(decorator.expression);
        if (node.computed) walk(node.key);
        walk(node.value);
        return;

      case "LabeledStatement":
        walk(node.body);
        return;

      case "Identifier":
        references.push({ name: node.name, scope: currentScope });
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

  // Free variables = references not bound in their own or any enclosing scope, minus builtins
  const freeVars = new Set<string>();
  for (const { name, scope } of references) {
    if (!isBoundInScope(scope, name) && !ES_BUILTINS.has(name)) {
      freeVars.add(name);
    }
  }
  return freeVars;
}
