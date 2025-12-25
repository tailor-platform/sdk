import type { TailorDBField, DBFieldMetadata, Hook, OperatorFieldConfig } from "./types";

// Since there's naming difference between platform and sdk,
// use this mapping in all scripts to provide variables that match sdk types.
export const tailorUserMap = /* js */ `{ id: user.id, type: user.type, workspaceId: user.workspace_id, attributes: user.attribute_map, attributeList: user.attributes }`;

/**
 * Convert a function to a string representation.
 * Handles method shorthand syntax (e.g., `create() { ... }`) by converting it to
 * a function expression (e.g., `function create() { ... }`).
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
 */
const convertHookToExpr = (
  fn: NonNullable<Hook<unknown, unknown>["create"] | Hook<unknown, unknown>["update"]>,
): string => {
  const normalized = stringifyFunction(fn);
  return `(${normalized})({ value: _value, data: _data, user: ${tailorUserMap} })`;
};

/**
 * Parse TailorDBField into OperatorFieldConfig.
 * This transforms user-defined functions into script expressions.
 */

export function parseFieldConfig(field: TailorDBField<any, any>): OperatorFieldConfig {
  const metadata = field.metadata as DBFieldMetadata;
  const fieldType = field.type;

  const nestedFields = field.fields as Record<string, TailorDBField<any, any>> | undefined;

  return {
    type: fieldType,
    ...metadata,
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
          expr: `(${fn.toString().trim()})({ value: _value, data: _data, user: ${tailorUserMap} })`,
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
