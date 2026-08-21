import type { ScriptExprKind } from "./hook-args-object";
import type { PrecompiledScriptExprKey } from "./types";

const PRECOMPILED_EXPR_KEY: PrecompiledScriptExprKey = "__precompiledScriptExpr";

type AnyFunction = (...args: never[]) => unknown;

const precompiledExprs = new WeakMap<AnyFunction, Partial<Record<ScriptExprKind, string>>>();

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
  const entry = precompiledExprs.get(fn);
  if (entry) {
    return entry[kind];
  }
  const value = (fn as unknown as Record<PrecompiledScriptExprKey, unknown>)[PRECOMPILED_EXPR_KEY];
  return typeof value === "string" ? value : undefined;
}
