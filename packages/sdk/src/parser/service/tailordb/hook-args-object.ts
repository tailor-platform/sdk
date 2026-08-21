// Identifier the table-level wrapper (buildTypeScripts in type-script.ts) binds
// tailorPrincipalMap's result to, at most once per table, so per-hook exprs
// below can reference it instead of re-embedding the full mapping on every hook.
export const PRINCIPAL_VAR = "_principal";

export type ScriptExprKind =
  | "hooks.create"
  | "hooks.update"
  | "validate"
  | "typeHook.create"
  | "typeHook.update"
  | "typeValidate";

/**
 * Build the call-argument list a script expression is invoked with, keyed by the
 * kind of hook/validator it wraps. Shared by every caller that assembles a
 * `(${normalized})(${callArgs})` script expression - both `field.ts` and the CLI's
 * hook-precompilation bundler - so the two never drift apart.
 * @param kind - Kind of hook/validator the expression is for
 * @returns The literal source of the arguments (an object literal for every kind
 *   except `typeValidate`, which also appends a trailing `__issues` argument)
 */
export function buildHookCallArgs(kind: ScriptExprKind): string {
  switch (kind) {
    case "validate":
      return `{ value: _value }`;
    case "hooks.create":
      return `{ input: _value, invoker: ${PRINCIPAL_VAR}, now: _now }`;
    case "hooks.update":
      return `{ input: _value, oldValue: _oldValue, invoker: ${PRINCIPAL_VAR}, now: _now }`;
    case "typeHook.create":
    case "typeHook.update":
      return `{ input: _input, oldRecord: _oldRecord, invoker: ${PRINCIPAL_VAR}, now: _now }`;
    case "typeValidate":
      return `{ newRecord: _newRecord, oldRecord: _oldRecord, invoker: ${PRINCIPAL_VAR} }, __issues`;
    default:
      throw new Error(`Unknown script expr kind: ${kind satisfies never}`);
  }
}
