import { getPrecompiledScriptExpr } from "./hooks-validate-precompiled-expr";
import type {
  TailorAnyDBField,
  DBFieldMetadata,
  OperatorFieldConfig,
  RawRelationConfig,
} from "@/types/tailordb";
import type { TailorDBTypeRaw as TailorDBTypeSchemaOutput } from "@/types/tailordb.generated";

// Since there's naming difference between platform and sdk,
// use this mapping in all scripts to provide variables that match sdk types.
export const tailorUserMap = /* js */ `{ id: user.id, type: user.type, workspaceId: user.workspace_id, attributes: user.attribute_map, attributeList: user.attributes }`;

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
 * Argument-map literals passed to script invocations. The key (e.g. `_data`,
 * `_value`, `_input`) is the runtime binding the platform exposes at the
 * relevant scope; the property name (e.g. `data`, `value`) is the SDK-side
 * parameter name that callbacks destructure.
 */
export const SCRIPT_ARG_MAPS = {
  /** Field-level scope: `_value`, `_data`, and `user` are bound. */
  field: `{ value: _value, data: _data, user: ${tailorUserMap} }`,
  /** Record-level hook scope: each generated FieldHook binds the record to `_data`. */
  recordHook: `{ data: _data, user: ${tailorUserMap} }`,
  /** Record-level validate scope: type_validate binds the record to `_input`. */
  recordValidate: `{ data: _input, user: ${tailorUserMap} }`,
} as const;

export type ScriptArgMap = keyof typeof SCRIPT_ARG_MAPS;

/**
 * Compile a user-supplied callback into a JavaScript expression that invokes
 * it inside the platform script sandbox. Uses the bundled/precompiled body
 * when available (so `import`s in the user file resolve) and otherwise falls
 * back to stringifying the function — `stringifyFunction` rewrites method
 * shorthand into a function expression so the result is always callable.
 * @param fn - Callback to compile
 * @param argMap - Argument-map kind appropriate for the binding context
 * @returns JavaScript expression evaluating the callback at runtime
 */
export const compileScriptExpr = (
  fn: (...args: never[]) => unknown,
  argMap: ScriptArgMap = "field",
): string => {
  const precompiledExpr = getPrecompiledScriptExpr(fn);
  if (precompiledExpr) {
    return precompiledExpr;
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  const normalized = stringifyFunction(fn as unknown as Function);
  return `(${normalized})(${SCRIPT_ARG_MAPS[argMap]})`;
};

/**
 * Normalize a validator entry into a `{ fn, message }` pair. Accepts either a
 * bare predicate function or a `[fn, message]` tuple. When only a function is
 * supplied, synthesizes a default message from the function source so the
 * surfaced error still references the offending predicate.
 * @param v - Validator entry (function or `[function, message]` tuple)
 * @returns Predicate function and the resolved error message
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export function normalizeValidatorEntry(v: Function | [Function, string]): {
  fn: (...args: never[]) => unknown;
  message: string;
} {
  if (typeof v === "function") {
    return {
      fn: v as (...args: never[]) => unknown,
      message: `failed by \`${v.toString().trim()}\``,
    };
  }
  return { fn: v[0] as (...args: never[]) => unknown, message: v[1] };
}

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
      const { fn, message } = normalizeValidatorEntry(v);
      return {
        script: {
          expr: compileScriptExpr(fn),
        },
        errorMessage: message,
      };
    }),
    hooks: metadata.hooks
      ? {
          create: metadata.hooks.create
            ? {
                expr: compileScriptExpr(metadata.hooks.create as (...args: never[]) => unknown),
              }
            : undefined,
          update: metadata.hooks.update
            ? {
                expr: compileScriptExpr(metadata.hooks.update as (...args: never[]) => unknown),
              }
            : undefined,
        }
      : metadata.generated && fieldType === "datetime"
        ? {
            // Auto-generate timestamp hooks for fields created by db.fields.timestamps().
            // Required datetime (createdAt) gets a create hook;
            // optional datetime (updatedAt) gets an update hook.
            // Record-level hooks may override these per-key in `applyRecordHooksToFields`.
            create: metadata.required !== false ? { expr: "new Date()" } : undefined,
            update: metadata.required === false ? { expr: "new Date()" } : undefined,
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
