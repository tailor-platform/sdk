// Platform-injected record map for type-level hook/validate scripts.
const INPUT = "_input";
// Shared operation timestamp bound once per script execution.
const NOW = "_now";

type HookOperation = "create" | "update";

interface ScriptRef {
  expr: string;
}

/**
 * Minimal structural shape shared by parser `OperatorFieldConfig` and migration
 * `SnapshotFieldConfig`. Only the parts needed to aggregate type-level scripts.
 */
export interface ScriptFieldConfig {
  type: string;
  hooks?: {
    create?: ScriptRef;
    update?: ScriptRef;
  };
  validate?: { script?: ScriptRef; errorMessage: string }[];
  fields?: Record<string, ScriptFieldConfig>;
}

export interface TypeScripts {
  typeHook?: { create?: ScriptRef; update?: ScriptRef };
  typeValidate?: { create?: ScriptRef; update?: ScriptRef };
}

const key = (name: string) => JSON.stringify(name);

const isNestedType = (config: ScriptFieldConfig): boolean =>
  config.type === "nested" && config.fields !== undefined;

/**
 * Build the object literal that reconstructs one record level with hook overrides applied.
 * Returns null when no field under this level has a hook for the operation.
 * @param fields - Field configs at the current level.
 * @param accessExpr - JavaScript expression for the current object level.
 * @param operation - "create" or "update".
 * @returns Object-literal source, or null when nothing under this level is hooked.
 */
function buildHookObject(
  fields: Record<string, ScriptFieldConfig>,
  accessExpr: string,
  operation: HookOperation,
): string | null {
  const parts: string[] = [];

  for (const [name, config] of Object.entries(fields)) {
    const access = `${accessExpr}[${key(name)}]`;
    if (isNestedType(config) && config.fields) {
      const inner = buildHookObject(config.fields, `(${access} || {})`, operation);
      if (inner !== null) {
        parts.push(`${key(name)}: Object.assign({}, ${access}, ${inner})`);
      }
      continue;
    }

    const hook = config.hooks?.[operation];
    if (hook) {
      parts.push(`${key(name)}: ((_value) => (${hook.expr}))(${access})`);
    }
  }

  if (parts.length === 0) return null;
  return `{ ${parts.join(", ")} }`;
}

/**
 * Build validation statements for one record level.
 * Each leaf field with validators contributes a block that records the first
 * failing message keyed by its dotted field path.
 * @param fields - Field configs at the current level.
 * @param accessExpr - JavaScript expression for the current object level.
 * @param keyPrefix - Dotted path prefix for nested fields.
 * @returns One statement per leaf field that has validators.
 */
function buildValidateStatements(
  fields: Record<string, ScriptFieldConfig>,
  accessExpr: string,
  keyPrefix: string,
): string[] {
  const statements: string[] = [];

  for (const [name, config] of Object.entries(fields)) {
    const access = `${accessExpr}[${key(name)}]`;
    const fieldPath = keyPrefix ? `${keyPrefix}.${name}` : name;

    if (isNestedType(config) && config.fields) {
      statements.push(...buildValidateStatements(config.fields, `(${access} || {})`, fieldPath));
      continue;
    }

    const validators = (config.validate ?? []).filter((v) => v.script?.expr);
    if (validators.length > 0) {
      const chain = validators
        .map(
          (v) =>
            `if (!(${v.script?.expr})) { __errs[${key(fieldPath)}] = ${key(v.errorMessage)}; }`,
        )
        .join(" else ");
      statements.push(`{ const _value = ${access}; ${chain} }`);
    }
  }

  return statements;
}

function wrapHook(objectExpr: string): string {
  return `(() => { const ${NOW} = new Date(); const _data = ${INPUT}; return ${objectExpr}; })()`;
}

function wrapValidate(statements: string[]): string {
  return (
    `(() => { const _data = ${INPUT}; const __errs = {}; ` +
    `${statements.join(" ")} return __errs; })()`
  );
}

/**
 * Aggregate every field's create/update hook and validate into type-level scripts.
 * Hooks compute a single shared timestamp (`now`) per operation, so all fields
 * touched in one create/update observe the same instant. Validators run with the
 * same rules on create and update.
 * @param fields - Field configs keyed by field name (parser or snapshot shape).
 * @returns Type-level hook/validate scripts, omitting empties.
 */
export function buildTypeScripts(fields: Record<string, ScriptFieldConfig>): TypeScripts {
  const result: TypeScripts = {};

  const hook: { create?: ScriptRef; update?: ScriptRef } = {};
  for (const operation of ["create", "update"] as const) {
    const objectExpr = buildHookObject(fields, INPUT, operation);
    if (objectExpr !== null) {
      hook[operation] = { expr: wrapHook(objectExpr) };
    }
  }
  if (hook.create || hook.update) {
    result.typeHook = hook;
  }

  const statements = buildValidateStatements(fields, INPUT, "");
  if (statements.length > 0) {
    const expr = wrapValidate(statements);
    result.typeValidate = { create: { expr }, update: { expr } };
  }

  return result;
}
