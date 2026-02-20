import { buildScriptExprWithInlineDependencies } from "./script-dependency-inliner";
import type {
  TailorAnyDBField,
  DBFieldMetadata,
  Hook,
  TypeSourceInfoEntry,
  OperatorFieldConfig,
  RawRelationConfig,
  TailorDBTypeSchemaOutput,
} from "./types";

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
 * Convert a hook function to a script expression.
 * @param fn - Hook function
 * @param sourceFilePath - Source file path for dependency inlining.
 * @param kind - Hook kind.
 * @returns JavaScript expression calling the hook
 */
const convertHookToExpr = (
  fn: NonNullable<Hook<unknown, unknown>["create"] | Hook<unknown, unknown>["update"]>,
  sourceFilePath?: string,
  kind: "hook.create" | "hook.update" = "hook.create",
): string => {
  const normalized = stringifyFunction(fn);
  return buildScriptExprWithInlineDependencies(normalized, kind, sourceFilePath);
};

/**
 * Parse TailorDBField into OperatorFieldConfig.
 * This transforms user-defined functions into script expressions.
 * @param field - TailorDB field definition
 * @param typeSourceInfo - Optional source metadata for the current type.
 * @returns Parsed operator field configuration
 */
export function parseFieldConfig(
  field: TailorDBTypeSchemaOutput["fields"][string],
  typeSourceInfo?: TypeSourceInfoEntry,
): OperatorFieldConfig {
  const metadata = field.metadata as DBFieldMetadata;
  const fieldType = field.type;
  // Access rawRelation via getter (if available)
  const rawRelation = (field as unknown as { rawRelation?: RawRelationConfig }).rawRelation;

  const nestedFields = field.fields as Record<string, TailorAnyDBField> | undefined;
  const sourceFilePath = typeSourceInfo?.filePath;
  return {
    type: fieldType,
    ...metadata,
    rawRelation,
    ...(fieldType === "nested" && nestedFields && Object.keys(nestedFields).length > 0
      ? {
          fields: Object.entries(nestedFields).reduce(
            (acc, [key, nestedField]) => {
              acc[key] = parseFieldConfig(nestedField, typeSourceInfo);
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
          expr: buildScriptExprWithInlineDependencies(
            stringifyFunction(fn),
            "validate",
            sourceFilePath,
          ),
        },
        errorMessage: message,
      };
    }),
    hooks: metadata.hooks
      ? {
          create: metadata.hooks.create
            ? {
                expr: convertHookToExpr(metadata.hooks.create, sourceFilePath, "hook.create"),
              }
            : undefined,
          update: metadata.hooks.update
            ? {
                expr: convertHookToExpr(metadata.hooks.update, sourceFilePath, "hook.update"),
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
