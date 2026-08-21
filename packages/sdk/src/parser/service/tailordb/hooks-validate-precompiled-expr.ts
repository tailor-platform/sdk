const PRECOMPILED_EXPR_KEY = "__precompiledScriptExprs";

type AnyFunction = (...args: never[]) => unknown;

/** Role a hook/validator function was precompiled for. Each role passes a different args shape. */
export type PrecompiledScriptKind =
  | "hooks.create"
  | "hooks.update"
  | "validate"
  | "typeHook.create"
  | "typeHook.update"
  | "typeValidate";

/**
 * Attach a precompiled script expression to a function object.
 * Keyed by role so one function reused across roles keeps a distinct expression per role.
 * @param fn - Function metadata object.
 * @param kind - Role the expression was compiled for.
 * @param expr - Precompiled script expression.
 */
export function setPrecompiledScriptExpr(
  fn: AnyFunction,
  kind: PrecompiledScriptKind,
  expr: string,
) {
  const holder = fn as unknown as Record<string, Partial<Record<PrecompiledScriptKind, string>>>;
  holder[PRECOMPILED_EXPR_KEY] ??= {};
  holder[PRECOMPILED_EXPR_KEY][kind] = expr;
}

/**
 * Read a precompiled script expression from a function object.
 * @param fn - Function metadata object.
 * @param kind - Role the expression was compiled for.
 * @returns Precompiled script expression if attached for that role.
 */
export function getPrecompiledScriptExpr(
  fn: AnyFunction,
  kind: PrecompiledScriptKind,
): string | undefined {
  const holder = fn as unknown as Record<string, unknown>;
  const store = holder[PRECOMPILED_EXPR_KEY];
  if (typeof store !== "object" || store === null) return undefined;
  const value = (store as Partial<Record<PrecompiledScriptKind, string>>)[kind];
  return typeof value === "string" ? value : undefined;
}
