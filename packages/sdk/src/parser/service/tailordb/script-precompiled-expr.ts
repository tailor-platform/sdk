const PRECOMPILED_EXPR_KEY = "__precompiledScriptExpr";

type AnyFunction = (...args: never[]) => unknown;

/**
 * Attach a precompiled script expression to a function object.
 * @param fn - Function metadata object.
 * @param expr - Precompiled script expression.
 */
export function setPrecompiledScriptExpr(fn: AnyFunction, expr: string) {
  (fn as unknown as Record<string, unknown>)[PRECOMPILED_EXPR_KEY] = expr;
}

/**
 * Read a precompiled script expression from a function object.
 * @param fn - Function metadata object.
 * @returns Precompiled script expression if attached.
 */
export function getPrecompiledScriptExpr(fn: AnyFunction): string | undefined {
  const value = (fn as unknown as Record<string, unknown>)[PRECOMPILED_EXPR_KEY];
  return typeof value === "string" ? value : undefined;
}
