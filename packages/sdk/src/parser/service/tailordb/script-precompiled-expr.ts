const PRECOMPILED_SCRIPT_EXPR_SYMBOL = Symbol.for("tailordb.precompiled.script.expr");

/**
 * Attach a precompiled script expression to a function object.
 * @param fn - Function metadata object.
 * @param expr - Precompiled script expression.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export function setPrecompiledScriptExpr(fn: Function, expr: string) {
  Object.defineProperty(fn, PRECOMPILED_SCRIPT_EXPR_SYMBOL, {
    value: expr,
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

/**
 * Read a precompiled script expression from a function object.
 * @param fn - Function metadata object.
 * @returns Precompiled script expression if attached.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export function getPrecompiledScriptExpr(fn: Function): string | undefined {
  const value = (fn as unknown as Record<symbol, unknown>)[PRECOMPILED_SCRIPT_EXPR_SYMBOL];
  return typeof value === "string" ? value : undefined;
}
