import type { EffectiveDateDefault } from "#/runtime/types";
import type { PrecompiledScriptExprKey, PrecompiledScriptExprMap, ScriptExprKind } from "./types";

const PRECOMPILED_EXPR_KEY: PrecompiledScriptExprKey =
  "tailor-platform/sdk:precompiled-script-expr";
const PRECOMPILED_EXPR_SYMBOL = Symbol.for(PRECOMPILED_EXPR_KEY);

type AnyFunction = (...args: never[]) => unknown;

// Keyed by the date default as well as the function: applications deployed from
// one process share module instances, so one hook may need one expression per
// default.
const precompiledExprs = new WeakMap<
  AnyFunction,
  Partial<Record<EffectiveDateDefault, PrecompiledScriptExprMap>>
>();

/**
 * Store a precompiled script expression for a function.
 * Keyed by role so one function reused across roles keeps a distinct expression per role.
 * @param fn - Hook or validator function the expression was compiled from.
 * @param kind - Role the expression was compiled for.
 * @param expr - Precompiled script expression.
 * @param dateDefault - Representation of `t` date fields the expression was compiled under.
 */
export function setPrecompiledScriptExpr(
  fn: AnyFunction,
  kind: ScriptExprKind,
  expr: string,
  dateDefault: EffectiveDateDefault = "legacy",
) {
  const byDefault = precompiledExprs.get(fn) ?? {};
  const entry = byDefault[dateDefault] ?? {};
  entry[kind] = expr;
  byDefault[dateDefault] = entry;
  precompiledExprs.set(fn, byDefault);
}

/**
 * Read a precompiled script expression for a function.
 * @param fn - Hook or validator function the expression was compiled from.
 * @param kind - Role the expression was compiled for.
 * @param dateDefault - Representation of `t` date fields the expression must have been compiled under.
 * @returns Precompiled script expression if attached for that role.
 */
export function getPrecompiledScriptExpr(
  fn: AnyFunction,
  kind: ScriptExprKind,
  dateDefault: EffectiveDateDefault = "legacy",
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
  return precompiledExprs.get(fn)?.[dateDefault]?.[kind];
}
