import { parseSync } from "oxc-parser";
import { assertParsableExpression } from "#/utils/script-expr";
import { getPrecompiledScriptExpr } from "./hooks-validate-precompiled-expr";
import type {
  TailorAnyDBField,
  DBFieldMetadata,
  RawRelationConfig,
} from "#/configure/services/tailordb/types";
import type { OperatorFieldConfig } from "#/parser/service/tailordb/types";
import type { TailorDBTypeRaw as TailorDBTypeSchemaOutput } from "#/types/tailordb.generated";

type FieldScriptContext = {
  typeName: string;
  fieldPath: readonly string[];
};

type ScriptFunction = (...args: never[]) => unknown;

type ScriptContextKind = "hooks.create" | "hooks.update" | "validate";

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
 * an anonymous function expression (e.g., `function () { ... }`), including
 * `async` and generator variants and shorthand bodies that themselves contain
 * arrow functions. The result is anonymous (rather than reusing the method
 * name) so a body that references an outer variable of the same name is not
 * shadowed by the generated function's own binding.
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

  if (property?.type === "Property" && property.method && property.computed) {
    throw new Error(
      "Computed-key method shorthand cannot be converted to a TailorDB script expression. " +
        "Use an arrow function or function expression instead.",
    );
  }
  if (
    property?.type === "Property" &&
    property.method &&
    property.value.type === "FunctionExpression"
  ) {
    const { async, generator } = property.value;
    const body = wrapped.slice(property.value.start, property.value.end);
    return `${async ? "async " : ""}function${generator ? "*" : ""} ${body}`;
  }
  return src;
};

function formatScriptContext(kind: ScriptContextKind, context: FieldScriptContext | undefined) {
  if (!context) {
    return kind === "validate" ? kind : "hooks";
  }
  return `${kind} for ${context.typeName}.${context.fieldPath.join(".")}`;
}

/**
 * Convert a hook or validator function to a script expression.
 * @param fn - Hook or validator function
 * @param kind - Label naming the source of the expression in conversion errors
 * @param context - Optional field context for conversion errors
 * @returns JavaScript expression calling the function
 */
const convertToScriptExpr = (
  fn: ScriptFunction,
  kind: ScriptContextKind,
  context: FieldScriptContext | undefined,
): string => {
  const precompiledExpr = getPrecompiledScriptExpr(fn);
  if (precompiledExpr) {
    return precompiledExpr;
  }
  const normalized = stringifyFunction(fn);
  return assertParsableExpression(
    `(${normalized})({ value: _value, data: _data, user: ${tailorUserMap} })`,
    formatScriptContext(kind, context),
  );
};

/**
 * Parse TailorDBField into OperatorFieldConfig.
 * This transforms user-defined functions into script expressions.
 * @param field - TailorDB field definition
 * @param context - Optional field context for conversion errors
 * @returns Parsed operator field configuration
 */
export function parseFieldConfig(
  field: TailorDBTypeSchemaOutput["fields"][string],
  context?: FieldScriptContext,
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
              acc[key] = parseFieldConfig(
                nestedField,
                context && {
                  ...context,
                  fieldPath: [...context.fieldPath, key],
                },
              );
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
          expr: convertToScriptExpr(fn, "validate", context),
        },
        errorMessage: message,
      };
    }),
    hooks: metadata.hooks
      ? {
          create: metadata.hooks.create
            ? {
                expr: convertToScriptExpr(
                  metadata.hooks.create as ScriptFunction,
                  "hooks.create",
                  context,
                ),
              }
            : undefined,
          update: metadata.hooks.update
            ? {
                expr: convertToScriptExpr(
                  metadata.hooks.update as ScriptFunction,
                  "hooks.update",
                  context,
                ),
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
