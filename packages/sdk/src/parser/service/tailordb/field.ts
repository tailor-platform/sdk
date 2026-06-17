import { getPrecompiledScriptExpr } from "./hooks-validate-precompiled-expr";
import type {
  TailorAnyDBField,
  DBFieldMetadata,
  RawRelationConfig,
} from "@/configure/services/tailordb/types";
import type { OperatorFieldConfig } from "@/parser/service/tailordb/types";
import type { TailorDBTypeRaw as TailorDBTypeSchemaOutput } from "@/types/tailordb.generated";

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

/**
 * Per-source field expressions for {@link makePrincipalExpr}. Each value is a JS
 * snippet evaluated against the raw server payload bound to `$raw`.
 */
interface PrincipalFieldExprs {
  /**
   * Raw type accessor. `raw` is matched against `USER_TYPE_*` when normalizing;
   * `fallback` (defaulting to `raw`) supplies the type for non-matching values,
   * which lets sources whose primary field is empty fall back to a secondary.
   */
  type: { raw: string; fallback?: string };
  /** Raw id accessor. */
  id: string;
  workspaceId: string;
  attributes: string;
  attributeList: string;
}

interface MakePrincipalExprOptions {
  source: string;
  fields: PrincipalFieldExprs;
  normalize: boolean;
  requireId?: boolean;
}

/**
 * Build the server→SDK principal mapping expression shared across services.
 *
 * All principal-bearing call sites (`caller`, `actor`, `invoker`) must agree on
 * the `TailorPrincipal | null` shape, so they are generated here rather than
 * hand-written per service.
 * @param options - Mapping source and field expressions
 * @param options.source - Expression yielding the raw server payload (e.g. `user`)
 * @param options.fields - Per-source accessors for each principal field
 * @param options.normalize - When true, map `USER_TYPE_*` to SDK type literals and
 *   return `null` for unspecified types or the nil-UUID id; when false, the
 *   payload is already in SDK shape and only `null` pass-through is applied
 * @param options.requireId - When true, missing ids are also mapped to `null`
 * @returns A JS expression string evaluating to `TailorPrincipal | null`
 */
export function makePrincipalExpr(options: MakePrincipalExprOptions): string {
  const { source, fields, normalize, requireId = false } = options;
  const body = /* js */ `{
    id,
    type,
    workspaceId: ${fields.workspaceId},
    attributes: ${fields.attributes},
    attributeList: ${fields.attributeList},
  }`;
  if (!normalize) {
    return /* js */ `(($raw) => {
  if (!$raw) {
    return null;
  }
  const id = ${fields.id};
  const type = ${fields.type.raw};
  return ${body};
})(${source})`;
  }
  const missingIdGuard = requireId ? " || !id" : "";
  return /* js */ `(($raw) => {
  if (!$raw) {
    return null;
  }
  const type = ${fields.type.raw} === "USER_TYPE_USER"
    ? "user"
    : ${fields.type.raw} === "USER_TYPE_MACHINE_USER"
      ? "machine_user"
      : ${fields.type.fallback ?? fields.type.raw};
  const id = ${fields.id};
  if (!type || type === "USER_TYPE_UNSPECIFIED" || id === "${NIL_UUID}"${missingIdGuard}) {
    return null;
  }
  return ${body};
})(${source})`;
}

// Since there's naming difference between platform and SDK, use this mapping in
// all scripts to provide variables that match `TailorPrincipal | null`.
export const tailorPrincipalMap = makePrincipalExpr({
  source: "user",
  normalize: true,
  fields: {
    type: { raw: "$raw?.type" },
    id: "$raw.id",
    workspaceId: "$raw.workspace_id ?? $raw.workspaceId",
    attributes: "$raw.attribute_map ?? $raw.attributeMap ?? {}",
    attributeList: "$raw.attributes ?? []",
  },
});

/**
 * Convert a function to a string representation.
 * Handles method shorthand syntax (e.g., `create() { ... }`) by converting it to
 * a function expression (e.g., `function create() { ... }`).
 * @param fn - Function to stringify
 * @returns Stringified function source
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export const stringifyFunction = (fn: Function): string => {
  const src = fn.toString().trim();
  // Method shorthand pattern: methodName(...) { ... }
  // Needs to be converted to: function methodName(...) { ... }
  if (
    /^[a-zA-Z_$][a-zA-Z0-9_$]*\s*\(/.test(src) &&
    !src.startsWith("function") &&
    !src.startsWith("(") &&
    !src.includes("=>")
  ) {
    return `function ${src}`;
  }
  return src;
};

/**
 * Convert a hook function to a script expression.
 * @param fn - Hook function
 * @returns JavaScript expression calling the hook
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
const convertHookToExpr = (fn: Function): string => {
  const precompiledExpr = getPrecompiledScriptExpr(fn as (...args: never[]) => unknown);
  if (precompiledExpr) {
    return precompiledExpr;
  }
  const normalized = stringifyFunction(fn);
  return `(${normalized})({ value: _value, data: _data, invoker: ${tailorPrincipalMap} })`;
};

/**
 * Parse TailorDBField into OperatorFieldConfig.
 * This transforms user-defined functions into script expressions.
 * @param field - TailorDB field definition
 * @returns Parsed operator field configuration
 */
export function parseFieldConfig(
  field: TailorDBTypeSchemaOutput["fields"][string],
): OperatorFieldConfig {
  const metadata = field.metadata as DBFieldMetadata;
  const fieldType = field.type;
  // Access rawRelation via getter (if available)
  const rawRelation = (field as unknown as { rawRelation?: RawRelationConfig }).rawRelation;

  const nestedFields = field.fields as Record<string, TailorAnyDBField> | undefined;
  return {
    type: fieldType,
    ...metadata,
    rawRelation,
    ...(fieldType === "nested" && nestedFields && Object.keys(nestedFields).length > 0
      ? {
          fields: Object.entries(nestedFields).reduce(
            (acc, [key, nestedField]) => {
              acc[key] = parseFieldConfig(nestedField);
              return acc;
            },
            {} as Record<string, OperatorFieldConfig>,
          ),
        }
      : {}),
    validate: metadata.validate?.map((v) => {
      const { fn, message } =
        typeof v === "function"
          ? { fn: v, message: `failed by \`${v.toString().trim()}\`` }
          : { fn: v[0], message: v[1] };

      return {
        script: {
          expr:
            getPrecompiledScriptExpr(fn) ??
            `(${fn.toString().trim()})({ value: _value, data: _data, invoker: ${tailorPrincipalMap} })`,
        },
        errorMessage: message,
      };
    }),
    hooks: metadata.hooks
      ? {
          create: metadata.hooks.create
            ? {
                expr: convertHookToExpr(metadata.hooks.create),
              }
            : undefined,
          update: metadata.hooks.update
            ? {
                expr: convertHookToExpr(metadata.hooks.update),
              }
            : undefined,
        }
      : undefined,
    serial: metadata.serial
      ? {
          start: metadata.serial.start,
          maxValue: metadata.serial.maxValue,
          format: "format" in metadata.serial ? metadata.serial.format : undefined,
        }
      : undefined,
  };
}
