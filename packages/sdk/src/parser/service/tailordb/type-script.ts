import { createHash } from "node:crypto";

// Platform-injected record map for type-level hook/validate scripts.
const INPUT = "_input";
const NEW_RECORD = "_newRecord";
const OLD_RECORD = "_oldRecord";
// Shared operation timestamp bound once per script execution.
const NOW = "_now";

const SOURCE_HASH_PREFIX = "// @sdk-source-hash:";

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

function collectFieldScriptSources(fields: Record<string, ScriptFieldConfig>): [string, unknown][] {
  const entries: [string, unknown][] = [];

  for (const [name, config] of Object.entries(fields).toSorted(([a], [b]) => a.localeCompare(b))) {
    const data: Record<string, unknown> = {};

    if (config.hooks?.create?.expr) data.hc = config.hooks.create.expr;
    if (config.hooks?.update?.expr) data.hu = config.hooks.update.expr;
    if (config.validate?.some((v) => v.script?.expr)) {
      data.v = config.validate
        .filter((v) => v.script?.expr)
        .map((v) => [v.script?.expr, v.errorMessage]);
    }
    if (config.default !== undefined) {
      data.d = config.default instanceof Date ? config.default.toISOString() : config.default;
      data.t = config.type;
    }

    if (config.fields) {
      const nested = collectFieldScriptSources(config.fields);
      if (nested.length > 0) {
        data.f = nested;
        data.a = !!config.array;
      }
    }

    if (Object.keys(data).length > 0) {
      entries.push([name, data]);
    }
  }

  return entries;
}

export function computeSourceScriptHash(
  fields: Record<string, ScriptFieldConfig>,
  options?: {
    typeHookExpr?: { create?: string; update?: string };
    typeValidateExpr?: string;
  },
): string | undefined {
  const fieldSources = collectFieldScriptSources(fields);
  const hasTypeScripts =
    fieldSources.length > 0 ||
    options?.typeHookExpr?.create ||
    options?.typeHookExpr?.update ||
    options?.typeValidateExpr;

  if (!hasTypeScripts) return undefined;

  const payload: unknown[] = [fieldSources];
  if (options?.typeHookExpr?.create) payload.push(["thc", options.typeHookExpr.create]);
  if (options?.typeHookExpr?.update) payload.push(["thu", options.typeHookExpr.update]);
  if (options?.typeValidateExpr) payload.push(["tve", options.typeValidateExpr]);

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

export function extractSourceScriptHash(expr: string): string | undefined {
  const match = expr.match(/\/\/ @sdk-source-hash:([0-9a-f]+)\s*$/);
  return match?.[1];
}

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
 * @param {boolean} nested - Whether building inside a nested field (rejects defaults)
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
    if (nested && config.default !== undefined) {
      throw new Error(`.default() cannot be used on nested inner field "${name}"`);
    }
    const hasDefault = operation === "create" && config.default !== undefined;

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
        .join("\n");
      statements.push(`{ const _value = ${access};\n${checks}\n}`);
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
              .join("\n");
            innerParts.push(`{ const _value = __el[${key(innerName)}];\n${checks}\n}`);
          }
        }
        if (innerParts.length > 0) {
          statements.push(
            `(${access} || []).forEach((__el, __idx) => {\n${innerParts.join("\n")}\n});`,
          );
        }
      } else {
        const nested = buildValidateStatements(config.fields, access, fieldPath);
        if (nested.length > 0) {
          statements.push(`if (${access} != null) {\n${nested.join("\n")}\n}`);
        }
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
  return `((_invoker) => { const __errs = {};${issuesFn}\n${statements.join("\n")}${typeValidateStmt}\nreturn __errs; })(typeof _invoker !== "undefined" ? _invoker : undefined)`;
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

  const hash = computeSourceScriptHash(fields, options);
  const hashSuffix = hash ? ` ${SOURCE_HASH_PREFIX}${hash}` : "";

  const hook: { create?: ScriptRef; update?: ScriptRef } = {};
  for (const operation of ["create", "update"] as const) {
    const perFieldExpr = buildHookObject(fields, INPUT, OLD_RECORD, operation);
    const typeLevelExpr = typeHookExpr?.[operation];
    let expr: string | undefined;
    if (perFieldExpr !== null && typeLevelExpr) {
      expr = `((_invoker) => { const ${NOW} = new Date(); const __fl = ${perFieldExpr}; return Object.assign({}, __fl, ((${INPUT}) => ${typeLevelExpr})(Object.assign({}, ${INPUT}, __fl))); })(typeof _invoker !== "undefined" ? _invoker : undefined)`;
    } else if (typeLevelExpr) {
      expr = wrapHook(typeLevelExpr);
    } else if (perFieldExpr !== null) {
      expr = wrapHook(perFieldExpr);
    }

    if (expr) {
      hook[operation] = { expr: expr + hashSuffix };
    }
  }
  if (hook.create || hook.update) {
    result.typeHook = hook;
  }

  const statements = buildValidateStatements(fields, NEW_RECORD, "");
  if (statements.length > 0 || typeValidateExpr) {
    const expr = wrapValidate(statements, typeValidateExpr) + hashSuffix;
    result.typeValidate = { create: { expr }, update: { expr } };
  }

  return result;
}
