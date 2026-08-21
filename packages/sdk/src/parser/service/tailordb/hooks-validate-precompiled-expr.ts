type AnyFunction = (...args: never[]) => unknown;

/** Role a hook/validator function was precompiled for. Each role passes a different args shape. */
export type PrecompiledScriptKind =
  | "hooks.create"
  | "hooks.update"
  | "validate"
  | "typeHook.create"
  | "typeHook.update"
  | "typeValidate";

const precompiledExprs = new WeakMap<AnyFunction, Partial<Record<PrecompiledScriptKind, string>>>();

/**
 * Attach a precompiled script expression to a function.
 * Keyed by role so one function reused across roles keeps a distinct expression per role.
 * @param fn - Hook or validator function the expression was compiled from.
 * @param kind - Role the expression was compiled for.
 * @param expr - Precompiled script expression.
 */
export function setPrecompiledScriptExpr(
  fn: AnyFunction,
  kind: PrecompiledScriptKind,
  expr: string,
) {
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
  kind: PrecompiledScriptKind,
): string | undefined {
  return precompiledExprs.get(fn)?.[kind];
}
