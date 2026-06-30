// Platform-injected record map for type-level hook/validate scripts.
const INPUT = "_input";
// Shared operation timestamp bound once per script execution.
const NOW = "_now";

const TIME_TYPES = new Set(["datetime", "date", "time"]);

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
  default?: unknown;
  fields?: Record<string, ScriptFieldConfig>;
}

export interface TypeScripts {
  typeHook?: { create?: ScriptRef; update?: ScriptRef };
  typeValidate?: { create?: ScriptRef; update?: ScriptRef };
}

const key = (name: string) => JSON.stringify(name);

const isNestedType = (config: ScriptFieldConfig): boolean =>
  config.type === "nested" && config.fields !== undefined;

function serializeDefault(value: unknown, fieldType: string): string {
  if (value === "now" && TIME_TYPES.has(fieldType)) return NOW;
  if (value instanceof Date) return `new Date(${JSON.stringify(value.toISOString())})`;
  return JSON.stringify(value);
}

/**
 * Build the object literal that reconstructs one record level with hook
 * overrides and defaults applied.  For create, defaults are appended as
 * `?? defaultValue` after the hook expression (field hook → default).
 * Returns null when no field under this level has a hook or default for
 * the operation.
 * @param {Record<string, ScriptFieldConfig>} fields - Field configurations
 * @param {string} accessExpr - JS expression to access the parent object
 * @param {HookOperation} operation - Hook operation type
 * @returns {string | null} Object literal expression or null
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
    const hasDefault = operation === "create" && config.default !== undefined;

    if (hook && hasDefault) {
      parts.push(
        `${key(name)}: ((_value) => (${hook.expr}))(${access}) ?? ${serializeDefault(config.default, config.type)}`,
      );
    } else if (hook) {
      parts.push(`${key(name)}: ((_value) => (${hook.expr}))(${access})`);
    } else if (hasDefault) {
      parts.push(`${key(name)}: ${access} ?? ${serializeDefault(config.default, config.type)}`);
    }
  }

  if (parts.length === 0) return null;
  return `{ ${parts.join(", ")} }`;
}

/**
 * Build validation statements for one record level.
 * Each leaf field with validators contributes a block that records the first
 * failing message keyed by its dotted field path.
 * @param {Record<string, ScriptFieldConfig>} fields - Field configurations
 * @param {string} accessExpr - JS expression to access the parent object
 * @param {string} keyPrefix - Dotted path prefix for error keys
 * @returns {string[]} Array of validation statement strings
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
 * Aggregate every field's create/update hook, default, and validate into
 * type-level scripts.  Hooks compute a single shared timestamp (`now`) per
 * operation, so all fields touched in one create/update observe the same
 * instant.  Defaults are applied after hooks on create only.  Validators
 * run with the same rules on create and update.
 * @param {Record<string, ScriptFieldConfig>} fields - Field configurations
 * @returns {TypeScripts} Aggregated type-level scripts
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
