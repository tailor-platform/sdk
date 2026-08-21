// Zero-dependency so `scripts/generate-precompiled-hooks.ts` can import it directly
// under plain Node (unlike the rest of this module tree, whose `#/`-aliased imports
// only resolve under vitest/tsdown/tsc, not Node's own ESM loader).

// Identifier the table-level wrapper (buildTypeScripts in type-script.ts) binds
// tailorPrincipalMap's result to, at most once per table, so per-hook exprs
// below can reference it instead of re-embedding the full mapping on every hook.
export const PRINCIPAL_VAR = "_principal";

export type ScriptExprKind =
  | "hooks.create"
  | "hooks.update"
  | "validate"
  | "typeHook"
  | "typeValidate";

/**
 * Build the call-argument object literal a script expression is invoked with, keyed
 * by the kind of hook/validator it wraps. Shared by every caller that assembles a
 * `(${normalized})(${argsObject})` script expression - both `field.ts` and the CLI's
 * hook-precompilation bundler - so the two never drift apart.
 * @param kind - Kind of hook/validator the expression is for
 * @returns The literal source of the object (and, for `typeValidate`, extra argument) passed to the call
 */
export function buildHookArgsObject(kind: ScriptExprKind): string {
  switch (kind) {
    case "validate":
      return `{ value: _value }`;
    case "hooks.create":
      return `{ input: _value, invoker: ${PRINCIPAL_VAR}, now: _now }`;
    case "hooks.update":
      return `{ input: _value, oldValue: _oldValue, invoker: ${PRINCIPAL_VAR}, now: _now }`;
    case "typeHook":
      return `{ input: _input, oldRecord: _oldRecord, invoker: ${PRINCIPAL_VAR}, now: _now }`;
    case "typeValidate":
      return `{ newRecord: _newRecord, oldRecord: _oldRecord, invoker: ${PRINCIPAL_VAR} }, __issues`;
  }
}
