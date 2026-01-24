import { type AllowedValues, type AllowedValuesOutput, mapAllowedValues } from "./field";
import {
  type TailorFieldType,
  type TailorToTs,
  type FieldMetadata,
  type DefinedFieldMetadata,
  type FieldOptions,
  type FieldOutput,
} from "./types";
import type { Prettify, InferFieldsOutput } from "./helpers";
import type { FieldValidateInput } from "./validation";
import type { TailorUser } from "@/configure/types";
import type { TailorFieldInput } from "@/parser/service/resolver/types";
import type { StandardSchemaV1 } from "@standard-schema/spec";

const regex = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  date: /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/,
  time: /^(?<hour>\d{2}):(?<minute>\d{2})$/,
  datetime:
    /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(.(?<millisec>\d{3}))?Z$/,
} as const;

// This helper type intentionally uses `any` as a placeholder for unknown field output.
// oxlint-disable-next-line no-explicit-any
export type TailorAnyField = TailorField<any>;

type FieldParseArgs = {
  value: unknown;
  data: unknown;
  user: TailorUser;
};

type FieldValidateValueArgs<T extends TailorFieldType> = {
  value: TailorToTs[T];
  data: unknown;
  user: TailorUser;
  pathArray: string[];
};

type FieldParseInternalArgs = {
  // Runtime input is unknown/untyped; we validate and narrow it inside the parser.
  // oxlint-disable-next-line no-explicit-any
  value: any;
  data: unknown;
  user: TailorUser;
  pathArray: string[];
};

/**
 * TailorField interface representing a field with metadata, type information, and optional nested fields.
 * This is the base field type used by both resolver types and TailorDB types.
 * Using interface to allow self-referencing in the fields property.
 */
export interface TailorField<
  Defined extends DefinedFieldMetadata = DefinedFieldMetadata,
  // Generic default output type (kept loose on purpose for library ergonomics).
  // oxlint-disable-next-line no-explicit-any
  Output = any,
  M extends FieldMetadata = FieldMetadata,
  T extends TailorFieldType = TailorFieldType,
> extends TailorFieldInput {
  readonly type: T;
  readonly fields: Record<string, TailorAnyField>;
  readonly _defined: Defined;
  readonly _output: Output;
  _metadata: M;

  /** Returns a shallow copy of the metadata */
  readonly metadata: M;

  /**
   * Set a description for the field
   * @param description - The description text
   * @returns The field with updated metadata
   */
  description<CurrentDefined extends Defined>(
    this: CurrentDefined extends { description: unknown }
      ? never
      : TailorField<CurrentDefined, Output>,
    description: string,
  ): TailorField<Prettify<CurrentDefined & { description: true }>, Output>;

  /**
   * Set a custom type name for enum or nested types
   * @param typeName - The custom type name
   * @returns The field with updated metadata
   */
  typeName<CurrentDefined extends Defined>(
    this: CurrentDefined extends { typeName: unknown }
      ? never
      : CurrentDefined extends { type: "enum" | "nested" }
        ? TailorField<CurrentDefined, Output>
        : never,
    typeName: string,
  ): TailorField<Prettify<CurrentDefined & { typeName: true }>, Output>;

  /**
   * Add validation functions to the field
   * @param validate - One or more validation functions
   * @returns The field with updated metadata
   */
  validate<CurrentDefined extends Defined>(
    this: CurrentDefined extends { validate: unknown }
      ? never
      : TailorField<CurrentDefined, Output>,
    ...validate: FieldValidateInput<Output>[]
  ): TailorField<Prettify<CurrentDefined & { validate: true }>, Output>;

  /**
   * Parse and validate a value against this field's validation rules
   * Returns StandardSchema Result type with success or failure
   * @param args - Value, context data, and user
   * @returns Validation result
   */
  parse(args: FieldParseArgs): StandardSchemaV1.Result<Output>;

  /**
   * Internal parse method that tracks field path for nested validation
   * @private
   * @param args - Parse arguments
   * @returns Validation result
   */
  _parseInternal(args: FieldParseInternalArgs): StandardSchemaV1.Result<Output>;
}

/**
 * Creates a new TailorField instance.
 * @param type - Field type
 * @param options - Field options
 * @param fields - Nested fields for object-like types
 * @param values - Allowed values for enum-like fields
 * @returns A new TailorField
 */
function createTailorField<
  const T extends TailorFieldType,
  const TOptions extends FieldOptions,
  const OutputBase = TailorToTs[T],
>(
  type: T,
  options?: TOptions,
  fields?: Record<string, TailorAnyField>,
  values?: AllowedValues,
): TailorField<
  { type: T; array: TOptions extends { array: true } ? true : false },
  FieldOutput<OutputBase, TOptions>
> {
  const _metadata: FieldMetadata = { required: true };

  if (options) {
    if (options.optional === true) {
      _metadata.required = false;
    }
    if (options.array === true) {
      _metadata.array = true;
    }
  }
  if (values) {
    _metadata.allowedValues = mapAllowedValues(values);
  }

  /**
   * Validate a single value (not an array element)
   * Used internally for array element validation
   * @param args - Value, context data, and user
   * @returns Array of validation issues
   */
  function validateValue(args: FieldValidateValueArgs<T>): StandardSchemaV1.Issue[] {
    const { value, data, user, pathArray } = args;
    const issues: StandardSchemaV1.Issue[] = [];

    // Type-specific validation
    switch (type) {
      case "string":
        if (typeof value !== "string") {
          issues.push({
            message: `Expected a string: received ${String(value)}`,
            path: pathArray.length > 0 ? pathArray : undefined,
          });
        }
        break;

      case "integer":
        if (typeof value !== "number" || !Number.isInteger(value)) {
          issues.push({
            message: `Expected an integer: received ${String(value)}`,
            path: pathArray.length > 0 ? pathArray : undefined,
          });
        }
        break;

      case "float":
        if (typeof value !== "number" || !Number.isFinite(value)) {
          issues.push({
            message: `Expected a number: received ${String(value)}`,
            path: pathArray.length > 0 ? pathArray : undefined,
          });
        }
        break;

      case "boolean":
        if (typeof value !== "boolean") {
          issues.push({
            message: `Expected a boolean: received ${String(value)}`,
            path: pathArray.length > 0 ? pathArray : undefined,
          });
        }
        break;

      case "uuid":
        if (typeof value !== "string" || !regex.uuid.test(value)) {
          issues.push({
            message: `Expected a valid UUID: received ${String(value)}`,
            path: pathArray.length > 0 ? pathArray : undefined,
          });
        }
        break;
      case "date":
        if (typeof value !== "string" || !regex.date.test(value)) {
          issues.push({
            message: `Expected to match "yyyy-MM-dd" format: received ${String(value)}`,
            path: pathArray.length > 0 ? pathArray : undefined,
          });
        }
        break;
      case "datetime":
        if (typeof value !== "string" || !regex.datetime.test(value)) {
          issues.push({
            message: `Expected to match ISO format: received ${String(value)}`,
            path: pathArray.length > 0 ? pathArray : undefined,
          });
        }
        break;
      case "time":
        if (typeof value !== "string" || !regex.time.test(value)) {
          issues.push({
            message: `Expected to match "HH:mm" format: received ${String(value)}`,
            path: pathArray.length > 0 ? pathArray : undefined,
          });
        }
        break;
      case "enum":
        if (field._metadata.allowedValues) {
          const allowedValues = field._metadata.allowedValues.map((v) => v.value);
          if (typeof value !== "string" || !allowedValues.includes(value)) {
            issues.push({
              message: `Must be one of [${allowedValues.join(", ")}]: received ${String(value)}`,
              path: pathArray.length > 0 ? pathArray : undefined,
            });
          }
        }
        break;

      case "nested":
        // Validate nested object fields
        if (
          typeof value !== "object" ||
          value === null ||
          Array.isArray(value) ||
          value instanceof Date
        ) {
          issues.push({
            message: `Expected an object: received ${String(value)}`,
            path: pathArray.length > 0 ? pathArray : undefined,
          });
        } else if (field.fields && Object.keys(field.fields).length > 0) {
          for (const [fieldName, nestedField] of Object.entries(field.fields)) {
            const fieldValue = value?.[fieldName];
            const result = nestedField._parseInternal({
              value: fieldValue,
              data,
              user,
              pathArray: pathArray.concat(fieldName),
            });
            if (result.issues) {
              issues.push(...result.issues);
            }
          }
        }
        break;
    }

    // Custom validation functions
    const validateFns = field._metadata.validate;
    if (validateFns && validateFns.length > 0) {
      for (const validateInput of validateFns) {
        const { fn, message } =
          typeof validateInput === "function"
            ? { fn: validateInput, message: "Validation failed" }
            : { fn: validateInput[0], message: validateInput[1] };

        if (!fn({ value, data, user })) {
          issues.push({
            message,
            path: pathArray.length > 0 ? pathArray : undefined,
          });
        }
      }
    }

    return issues;
  }

  /**
   * Internal parse method that tracks field path for nested validation
   * @param args - Parse arguments
   * @returns Parse result with value or issues
   */
  function parseInternal(
    args: FieldParseInternalArgs,
  ): StandardSchemaV1.Result<FieldOutput<OutputBase, TOptions>> {
    const { value, data, user, pathArray } = args;
    const issues: StandardSchemaV1.Issue[] = [];

    // 1. Check required/optional
    const isNullOrUndefined = value === null || value === undefined;
    if (field._metadata.required && isNullOrUndefined) {
      issues.push({
        message: "Required field is missing",
        path: pathArray.length > 0 ? pathArray : undefined,
      });
      return { issues };
    }

    // If optional and null/undefined, skip further validation
    if (!field._metadata.required && isNullOrUndefined) {
      return { value };
    }

    // 2. Check array type
    if (field._metadata.array) {
      if (!Array.isArray(value)) {
        issues.push({
          message: "Expected an array",
          path: pathArray.length > 0 ? pathArray : undefined,
        });
        return { issues };
      }

      // Validate each array element (without array flag)
      for (let i = 0; i < value.length; i++) {
        const elementValue = value[i];
        const elementPath = pathArray.concat(`[${i}]`);

        // Validate element with same type but without array flag
        const elementIssues = validateValue({
          value: elementValue,
          data,
          user,
          pathArray: elementPath,
        });
        if (elementIssues.length > 0) {
          issues.push(...elementIssues);
        }
      }

      if (issues.length > 0) {
        return { issues };
      }
      return { value: value as FieldOutput<OutputBase, TOptions> };
    }

    // 3. Type-specific validation and custom validation
    const valueIssues = validateValue({ value, data, user, pathArray });
    issues.push(...valueIssues);

    if (issues.length > 0) {
      return { issues };
    }

    return { value };
  }

  const field: TailorField<
    { type: T; array: TOptions extends { array: true } ? true : false },
    FieldOutput<OutputBase, TOptions>
  > = {
    type,
    fields: fields ?? {},
    _defined: undefined as unknown as {
      type: T;
      array: TOptions extends { array: true } ? true : false;
    },
    _output: undefined as FieldOutput<OutputBase, TOptions>,
    _metadata,

    get metadata() {
      return { ...this._metadata };
    },

    description(description: string) {
      this._metadata.description = description;
      // Fluent API returns this with updated type
      // oxlint-disable-next-line no-explicit-any
      return this as any;
    },

    typeName(typeName: string) {
      this._metadata.typeName = typeName;
      // Fluent API returns this with updated type
      // oxlint-disable-next-line no-explicit-any
      return this as any;
    },

    validate(...validateInputs: FieldValidateInput<FieldOutput<OutputBase, TOptions>>[]) {
      this._metadata.validate = validateInputs;
      // Fluent API returns this with updated type
      // oxlint-disable-next-line no-explicit-any
      return this as any;
    },

    parse(args: FieldParseArgs): StandardSchemaV1.Result<FieldOutput<OutputBase, TOptions>> {
      return parseInternal({
        value: args.value,
        data: args.data,
        user: args.user,
        pathArray: [],
      });
    },

    _parseInternal: parseInternal,
  };

  return field;
}

function uuid<const Opt extends FieldOptions>(options?: Opt) {
  return createTailorField("uuid", options);
}

function string<const Opt extends FieldOptions>(options?: Opt) {
  return createTailorField("string", options);
}

function bool<const Opt extends FieldOptions>(options?: Opt) {
  return createTailorField("boolean", options);
}

function int<const Opt extends FieldOptions>(options?: Opt) {
  return createTailorField("integer", options);
}

function float<const Opt extends FieldOptions>(options?: Opt) {
  return createTailorField("float", options);
}

function date<const Opt extends FieldOptions>(options?: Opt) {
  return createTailorField("date", options);
}

function datetime<const Opt extends FieldOptions>(options?: Opt) {
  return createTailorField("datetime", options);
}

function time<const Opt extends FieldOptions>(options?: Opt) {
  return createTailorField("time", options);
}

function _enum<const V extends AllowedValues, const Opt extends FieldOptions>(
  values: V,
  options?: Opt,
): TailorField<
  { type: "enum"; array: Opt extends { array: true } ? true : false },
  FieldOutput<AllowedValuesOutput<V>, Opt>
> {
  return createTailorField<"enum", Opt, AllowedValuesOutput<V>>("enum", options, undefined, values);
}

function object<const F extends Record<string, TailorAnyField>, const Opt extends FieldOptions>(
  fields: F,
  options?: Opt,
) {
  const objectField = createTailorField("nested", options, fields) as TailorField<
    { type: "nested"; array: Opt extends { array: true } ? true : false },
    FieldOutput<InferFieldsOutput<F>, Opt>
  >;
  return objectField;
}

export const t = {
  uuid,
  string,
  bool,
  int,
  float,
  date,
  datetime,
  time,
  enum: _enum,
  object,
};
