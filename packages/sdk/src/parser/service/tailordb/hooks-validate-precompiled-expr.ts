import type { PrecompiledScriptExprKey, PrecompiledScriptExprMap, ScriptExprKind } from "./types";

const PRECOMPILED_EXPR_KEY: PrecompiledScriptExprKey =
  "tailor-platform/sdk:precompiled-script-expr";
const PRECOMPILED_EXPR_SYMBOL = Symbol.for(PRECOMPILED_EXPR_KEY);

type AnyFunction = (...args: never[]) => unknown;

const precompiledExprs = new WeakMap<AnyFunction, PrecompiledScriptExprMap>();

/**
 * Store a precompiled script expression for a function.
 * Keyed by role so one function reused across roles keeps a distinct expression per role.
 * @param fn - Hook or validator function the expression was compiled from.
 * @param kind - Role the expression was compiled for.
 * @param expr - Precompiled script expression.
 */
export function setPrecompiledScriptExpr(fn: AnyFunction, kind: ScriptExprKind, expr: string) {
  const entry = precompiledExprs.get(fn) ?? {};
  entry[kind] = expr;
  precompiledExprs.set(fn, entry);
}

/**
 * Read a precompiled script expression for a function.
 * @param fn - Hook or validator function the expression was compiled from.
 * @param kind - Role the expression was compiled for.
 * @returns Precompiled script expression if attached for that role.
 */
export function getPrecompiledScriptExpr(
  fn: AnyFunction,
  kind: ScriptExprKind,
): string | undefined {
  const pinnedExprs = Object.hasOwn(fn, PRECOMPILED_EXPR_SYMBOL)
    ? (fn as unknown as Record<symbol, unknown>)[PRECOMPILED_EXPR_SYMBOL]
    : undefined;
  if (typeof pinnedExprs === "object" && pinnedExprs !== null && Object.hasOwn(pinnedExprs, kind)) {
    const pinnedExpr = (pinnedExprs as Partial<Record<ScriptExprKind, unknown>>)[kind];
    if (typeof pinnedExpr === "string") {
      return pinnedExpr;
    }
  }
  return precompiledExprs.get(fn)?.[kind];
}
