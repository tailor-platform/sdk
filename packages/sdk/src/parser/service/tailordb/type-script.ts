// Platform-injected record map for type-level hook/validate scripts.
const INPUT = "_input";
const NEW_RECORD = "_newRecord";
const OLD_RECORD = "_oldRecord";
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
  array?: boolean;
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
 * @param {string} oldAccessExpr - JS expression to access the old record parent
 * @param {HookOperation} operation - Hook operation type
 * @param {boolean} nested - Whether building inside a nested field (skips defaults)
 * @returns {string | null} Object literal expression or null
 */
function buildHookObject(
  fields: Record<string, ScriptFieldConfig>,
  accessExpr: string,
  oldAccessExpr: string,
  operation: HookOperation,
  nested = false,
): string | null {
  const parts: string[] = [];

  for (const [name, config] of Object.entries(fields)) {
    const access = `${accessExpr}[${key(name)}]`;
    const oldAccess = `${oldAccessExpr}?.[${key(name)}]`;
    if (isNestedType(config) && config.fields) {
      if (config.array) {
        const inner = buildHookObject(config.fields, "__el", "undefined", operation, true);
        if (inner !== null) {
          parts.push(
            `${key(name)}: (${access} || []).map((__el) => Object.assign({}, __el, ${inner}))`,
          );
        }
      } else {
        const inner = buildHookObject(
          config.fields,
          `(${access} || {})`,
          oldAccess,
          operation,
          true,
        );
        if (inner !== null) {
          parts.push(`${key(name)}: Object.assign({}, ${access}, ${inner})`);
        }
      }
      continue;
    }

    const hook = config.hooks?.[operation];
    const hasDefault = !nested && operation === "create" && config.default !== undefined;

    if (hook && hasDefault) {
      parts.push(
        `${key(name)}: ((_value) => (${hook.expr}))(${access}) ?? ${serializeDefault(config.default, config.type)}`,
      );
    } else if (hook && operation === "create") {
      parts.push(`${key(name)}: ((_value) => (${hook.expr}))(${access})`);
    } else if (hook) {
      parts.push(
        `${key(name)}: ((_value, _oldValue) => (${hook.expr}))(${access}, ${oldAccess} ?? null)`,
      );
    } else if (hasDefault) {
      parts.push(`${key(name)}: ${access} ?? ${serializeDefault(config.default, config.type)}`);
    }
  }

  if (parts.length === 0) return null;
  return `{ ${parts.join(", ")} }`;
}

/**
 * Build validation statements for one record level.
 * Each leaf field with validators contributes a block that runs every
 * validator and records all failing messages keyed by dotted field path.
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

    const validators = (config.validate ?? []).filter((v) => v.script?.expr);
    if (validators.length > 0) {
      const checks = validators
        .map(
          (v) =>
            `{ const __r = (${v.script?.expr}); if (typeof __r === "string") { __errs[${key(fieldPath)}] = __r; } }`,
        )
        .join(" ");
      statements.push(`{ const _value = ${access}; ${checks} }`);
    }

    if (isNestedType(config) && config.fields) {
      if (config.array) {
        const innerParts: string[] = [];
        for (const [innerName, innerConfig] of Object.entries(config.fields)) {
          const innerValidators = (innerConfig.validate ?? []).filter((v) => v.script?.expr);
          if (innerValidators.length > 0) {
            const errorKeyExpr = `${JSON.stringify(fieldPath + "[")} + __idx + ${JSON.stringify("]." + innerName)}`;
            const checks = innerValidators
              .map(
                (v) =>
                  `{ const __r = (${v.script?.expr}); if (typeof __r === "string") { __errs[${errorKeyExpr}] = __r; } }`,
              )
              .join(" ");
            innerParts.push(`{ const _value = __el[${key(innerName)}]; ${checks} }`);
          }
        }
        if (innerParts.length > 0) {
          statements.push(
            `(${access} || []).forEach((__el, __idx) => { ${innerParts.join(" ")} })`,
          );
        }
      } else {
        statements.push(...buildValidateStatements(config.fields, `(${access} || {})`, fieldPath));
      }
    }
  }

  return statements;
}

function wrapHook(objectExpr: string): string {
  return `((_invoker) => { const ${NOW} = new Date(); return ${objectExpr}; })(typeof _invoker !== "undefined" ? _invoker : undefined)`;
}

function wrapValidate(statements: string[], typeValidateExpr?: string): string {
  const issuesFn = typeValidateExpr ? " const __issues = (f, m) => { __errs[f] = m; };" : "";
  const typeValidateStmt = typeValidateExpr ? ` ${typeValidateExpr};` : "";
  return `((_invoker) => { const __errs = {};${issuesFn} ${statements.join(" ")}${typeValidateStmt} return __errs; })(typeof _invoker !== "undefined" ? _invoker : undefined)`;
}

/**
 * Aggregate every field's create/update hook, default, and validate into
 * type-level scripts.  Hooks compute a single shared timestamp (`now`) per
 * operation, so all fields touched in one create/update observe the same
 * instant.  Defaults are applied after hooks on create only.  Validators
 * run with the same rules on create and update.
 * @param fields - Per-field script configuration
 * @param options - Optional type-level hook/validate expressions
 * @returns Aggregated type-level scripts
 */
export function buildTypeScripts(
  fields: Record<string, ScriptFieldConfig>,
  options?: {
    typeHookExpr?: { create?: string; update?: string };
    typeValidateExpr?: string;
  },
): TypeScripts {
  const result: TypeScripts = {};
  const typeHookExpr = options?.typeHookExpr;
  const typeValidateExpr = options?.typeValidateExpr;

  const hook: { create?: ScriptRef; update?: ScriptRef } = {};
  for (const operation of ["create", "update"] as const) {
    const perFieldExpr = buildHookObject(fields, INPUT, OLD_RECORD, operation);
    const typeLevelExpr = typeHookExpr?.[operation];

    if (perFieldExpr !== null && typeLevelExpr) {
      hook[operation] = {
        expr: `((_invoker) => { const ${NOW} = new Date(); const __fl = ${perFieldExpr}; return Object.assign({}, __fl, ((${INPUT}) => ${typeLevelExpr})(Object.assign({}, ${INPUT}, __fl))); })(typeof _invoker !== "undefined" ? _invoker : undefined)`,
      };
    } else if (typeLevelExpr) {
      hook[operation] = { expr: wrapHook(typeLevelExpr) };
    } else if (perFieldExpr !== null) {
      hook[operation] = { expr: wrapHook(perFieldExpr) };
    }
  }
  if (hook.create || hook.update) {
    result.typeHook = hook;
  }

  const statements = buildValidateStatements(fields, NEW_RECORD, "");
  if (statements.length > 0 || typeValidateExpr) {
    const expr = wrapValidate(statements, typeValidateExpr);
    result.typeValidate = { create: { expr }, update: { expr } };
  }

  return result;
}
