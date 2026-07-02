import { parseSync } from "oxc-parser";
import { getPrecompiledScriptExpr } from "./hooks-validate-precompiled-expr";
import type {
  TailorAnyDBField,
  DBFieldMetadata,
  RawRelationConfig,
} from "#/configure/services/tailordb/types";
import type { OperatorFieldConfig } from "#/parser/service/tailordb/types";
import type { TailorDBTypeRaw as TailorDBTypeSchemaOutput } from "#/types/tailordb.generated";

// Since there's naming difference between platform and sdk,
// use this mapping in all scripts to provide variables that match sdk types.
export const tailorUserMap = /* js */ `{ id: user.id, type: user.type, workspaceId: user.workspace_id, attributes: user.attribute_map, attributeList: user.attributes }`;

/**
 * Parse `wrapped` and return the first property of the top-level parenthesized
 * object expression, or `undefined` if it does not parse as one.
 * @param wrapped - Source wrapped as `({ ... })`
 * @returns The first object property, or `undefined`
 */
const firstObjectProperty = (wrapped: string) => {
  const parseResult = parseSync("stringify-function.ts", wrapped, { sourceType: "module" });
  if (parseResult.errors.length > 0) {
    return undefined;
  }
  const expressionStatement = parseResult.program.body[0];
  const objectExpression =
    expressionStatement?.type === "ExpressionStatement" &&
    expressionStatement.expression.type === "ParenthesizedExpression"
      ? expressionStatement.expression.expression
      : undefined;
  return objectExpression?.type === "ObjectExpression" ? objectExpression.properties[0] : undefined;
};

/**
 * Convert a function to a string representation.
 * Handles method shorthand syntax (e.g., `create() { ... }`) by converting it to
 * a function expression (e.g., `function create() { ... }`), including `async`
 * and generator variants and shorthand bodies that themselves contain arrow
 * functions.
 * @param fn - Function to stringify
 * @returns Stringified function source
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export const stringifyFunction = (fn: Function): string => {
  const src = fn.toString().trim();
  // `src` is already a valid function/arrow expression (e.g. `function () {}`,
  // `() => {}`) if it parses as an object property value as-is; leave it untouched.
  if (firstObjectProperty(`({m: ${src}})`)) {
    return src;
  }
  // Otherwise, method shorthand (e.g. `create() {}`, `async create() {}`) is
  // only valid inside an object literal, so parse it as an object property to
  // detect and convert it via the AST rather than guessing from source text.
  const wrapped = `({${src}})`;
  const property = firstObjectProperty(wrapped);

  if (
    property?.type === "Property" &&
    property.method &&
    !property.computed &&
    property.key.type === "Identifier" &&
    property.value.type === "FunctionExpression"
  ) {
    const { async, generator } = property.value;
    const body = wrapped.slice(property.value.start, property.value.end);
    return `${async ? "async " : ""}function${generator ? "*" : ""} ${property.key.name}${body}`;
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
  return `(${normalized})({ value: _value, data: _data, user: ${tailorUserMap} })`;
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
            `(${fn.toString().trim()})({ value: _value, data: _data, user: ${tailorUserMap} })`,
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
