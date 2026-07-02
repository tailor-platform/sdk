import { type AllowedValues, type AllowedValuesOutput, mapAllowedValues } from "./field";
import type {
  DefinedFieldMetadata,
  TailorFieldType,
  TailorToTs,
  FieldMetadata,
  FieldOptions,
  FieldOutput,
  TailorField as TailorFieldBase,
  FieldValidateInput,
} from "#/configure/types/field.types";
import type { TailorPrincipal } from "#/runtime/types";
import type { InferFieldsOutput, TypeLevelError } from "#/types/helpers";
import type { StandardSchemaV1 } from "@standard-schema/spec";

// Erased fields stay assignable across builder method-state changes.
// oxlint-disable-next-line no-explicit-any
type AnyBuilderMethod = any;

export type TailorAnyField = Omit<
  TailorFieldBase<AnyBuilderMethod, AnyBuilderMethod, FieldMetadata, TailorFieldType>,
  "fields"
> & {
  readonly fields: Record<string, AnyBuilderMethod>;
  _metadata: FieldMetadata;
  description: AnyBuilderMethod;
  typeName: AnyBuilderMethod;
  validate: AnyBuilderMethod;
  parse: AnyBuilderMethod;
  _parseInternal: AnyBuilderMethod;
};

type IsAny<T> = 0 extends 1 & T ? true : false;
type WithFieldDescription<Defined> = Defined & { description: true };
type WithFieldTypeName<Defined> = Defined & { typeName: true };
type WithFieldValidate<Defined> = Defined & { validate: true };
type FieldDescriptionFn<Defined extends DefinedFieldMetadata, Output> = (
  description: string,
) => TailorField<WithFieldDescription<Defined>, Output>;
type FieldTypeNameFn<Defined extends DefinedFieldMetadata, Output> = (
  typeName: string,
) => TailorField<WithFieldTypeName<Defined>, Output>;
type FieldValidateFn<Defined extends DefinedFieldMetadata, Output> = (
  ...validate: FieldValidateInput<Output>[]
) => TailorField<WithFieldValidate<Defined>, Output>;
type FieldDescriptionMethod<Defined extends DefinedFieldMetadata, Output> =
  IsAny<Defined> extends true
    ? FieldDescriptionFn<Defined, Output>
    : Defined extends { description: unknown }
      ? TypeLevelError<".description() has already been set">
      : FieldDescriptionFn<Defined, Output>;
type FieldTypeNameMethod<Defined extends DefinedFieldMetadata, Output> =
  IsAny<Defined> extends true
    ? TypeLevelError<string>
    : Defined extends { typeName: unknown }
      ? TypeLevelError<".typeName() has already been set">
      : Defined extends { type: "enum" | "nested" }
        ? FieldTypeNameFn<Defined, Output>
        : TypeLevelError<"typeName can only be set on enum or object fields">;
type FieldValidateMethod<Defined extends DefinedFieldMetadata, Output> =
  IsAny<Defined> extends true
    ? FieldValidateFn<Defined, Output>
    : Defined extends { validate: unknown }
      ? TypeLevelError<".validate() has already been set">
      : FieldValidateFn<Defined, Output>;

/**
 * Full TailorField interface with builder methods.
 * Extends the minimal structural interface from types/ with fluent API methods.
 */
export interface TailorField<
  Defined extends DefinedFieldMetadata = DefinedFieldMetadata,
  // Generic default output type (kept loose on purpose for library ergonomics).
  // oxlint-disable-next-line no-explicit-any
  Output = any,
  M extends FieldMetadata = FieldMetadata,
  T extends TailorFieldType = TailorFieldType,
> extends TailorFieldBase<Defined, Output, M, T> {
  readonly fields: Record<string, TailorAnyField>;
  _metadata: M;

  /**
   * Set a description for the field
   * @param description - The description text
   * @returns The field with updated metadata
   */
  description: FieldDescriptionMethod<Defined, Output>;

  /**
   * Set a custom type name for enum or nested types
   * @param typeName - The custom type name
   * @returns The field with updated metadata
   */
  typeName: FieldTypeNameMethod<Defined, Output>;

  /**
   * Add validation functions to the field
   * @param validate - One or more validation functions
   * @returns The field with updated metadata
   */
  validate: FieldValidateMethod<Defined, Output>;

  /**
   * Parse and validate a value against this field's validation rules
   * Returns StandardSchema Result type with success or failure
   * @param args - Value, context data, and invoker
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
 * Internal shape carried by every runtime field for clone-on-write support.
 *
 * `clone()` is intentionally kept off the public {@link TailorField} interface:
 * adding it there would force `TailorDBField` (which has a differently-typed
 * `clone`) to stop being assignable to `TailorField`, breaking the supported
 * `t.object({ field: db.string() })` usage. Every `t.*` and `db.*` field carries
 * a `clone()` at runtime, so the internal cast in `clone()` is safe.
 */
type CloneableField = { clone(): TailorAnyField };

const regex = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  date: /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/,
  time: /^(?<hour>\d{2}):(?<minute>\d{2})$/,
  datetime:
    /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})[Tt](?<hour>[01]\d|2[0-3]):(?<minute>[0-5]\d):(?<second>[0-5]\d|60)(\.(?<fraction>\d+))?(?<offset>[Zz]|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/,
  decimal: /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/,
} as const;

function isValidDateString(value: string): boolean {
  const match = regex.date.exec(value);
  return match?.groups !== undefined && isValidDateParts(match.groups);
}

function isValidDateTimeString(value: string): boolean {
  const match = regex.datetime.exec(value);
  return match?.groups !== undefined && isValidDateParts(match.groups);
}

function isValidDateParts(groups: Record<string, string | undefined>): boolean {
  const { year: yearValue, month: monthValue, day: dayValue } = groups;
  if (yearValue === undefined || monthValue === undefined || dayValue === undefined) {
    return false;
  }

  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }

  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
    month - 1
  ];
  return daysInMonth !== undefined && day <= daysInMonth;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

type FieldParseArgs = {
  value: unknown;
  data: unknown;
  invoker: TailorPrincipal | null;
};

type FieldValidateValueArgs<T extends TailorFieldType> = {
  value: TailorToTs[T];
  data: unknown;
  invoker: TailorPrincipal | null;
  pathArray: string[];
};

type FieldParseInternalArgs = {
  // Runtime input is unknown/untyped; we validate and narrow it inside the parser.
  // oxlint-disable-next-line no-explicit-any
  value: any;
  data: unknown;
  invoker: TailorPrincipal | null;
  pathArray: string[];
};

type TailorFieldRuntime<
  Defined extends DefinedFieldMetadata,
  Output,
  M extends FieldMetadata = FieldMetadata,
  T extends TailorFieldType = TailorFieldType,
> = TailorFieldBase<Defined, Output, M, T> & {
  readonly fields: Record<string, TailorAnyField>;
  _metadata: M;
  description(description: string): object;
  typeName(typeName: string): object;
  validate(...validate: FieldValidateInput<Output>[]): object;
  parse(args: FieldParseArgs): StandardSchemaV1.Result<Output>;
  _parseInternal(args: FieldParseInternalArgs): StandardSchemaV1.Result<Output>;
  clone(): TailorAnyField;
};

/**
 * Creates a new TailorField instance.
 * @param type - Field type
 * @param options - Field options
 * @param fields - Nested fields for object-like types
 * @param values - Allowed values for enum-like fields
 * @param metadata - Pre-built metadata to clone from (used by `clone()`); when
 *   given, the mutable containers are deep-copied here and `options`/`values` are
 *   ignored for metadata construction
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
  metadata?: FieldMetadata,
): TailorField<
  { type: T; array: TOptions extends { array: true } ? true : false },
  FieldOutput<OutputBase, TOptions>
>;
function createTailorField<
  const T extends TailorFieldType,
  const TOptions extends FieldOptions,
  const OutputBase = TailorToTs[T],
>(
  type: T,
  options?: TOptions,
  fields?: Record<string, TailorAnyField>,
  values?: AllowedValues,
  metadata?: FieldMetadata,
): object {
  type FieldValue = FieldOutput<OutputBase, TOptions>;

  // When cloning, take ownership of the source metadata and deep-copy its mutable
  // containers (enum value objects and `[fn, message]` validator tuples; validator
  // functions are kept by reference) so no two instances share mutable state.
  const _metadata: FieldMetadata = metadata
    ? {
        ...metadata,
        ...(metadata.allowedValues && {
          allowedValues: metadata.allowedValues.map((v) => ({ ...v })),
        }),
        ...(metadata.validate && {
          validate: metadata.validate.map((v) => (Array.isArray(v) ? ([...v] as typeof v) : v)),
        }),
      }
    : { required: true };

  if (!metadata) {
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
  }

  /**
   * Validate a single value (not an array element)
   * Used internally for array element validation
   * @param args - Value, context data, and invoker
   * @returns Array of validation issues
   */
  function validateValue(args: FieldValidateValueArgs<T>): StandardSchemaV1.Issue[] {
    const { value, data, invoker, pathArray } = args;
    const issues: StandardSchemaV1.Issue[] = [];
    const path = pathArray.length > 0 ? pathArray : undefined;

    // Type-specific validation
    switch (type) {
      case "string":
        if (typeof value !== "string") {
          issues.push({
            message: `Expected a string: received ${String(value)}`,
            path,
          });
        }
        break;

      case "integer":
        if (typeof value !== "number" || !Number.isInteger(value)) {
          issues.push({
            message: `Expected an integer: received ${String(value)}`,
            path,
          });
        }
        break;

      case "float":
        if (typeof value !== "number" || !Number.isFinite(value)) {
          issues.push({
            message: `Expected a number: received ${String(value)}`,
            path,
          });
        }
        break;

      case "boolean":
        if (typeof value !== "boolean") {
          issues.push({
            message: `Expected a boolean: received ${String(value)}`,
            path,
          });
        }
        break;

      case "uuid":
        if (typeof value !== "string" || !regex.uuid.test(value)) {
          issues.push({
            message: `Expected a valid UUID: received ${String(value)}`,
            path,
          });
        }
        break;
      case "date":
        if (typeof value !== "string" || !isValidDateString(value)) {
          issues.push({
            message: `Expected to match "yyyy-MM-dd" format: received ${String(value)}`,
            path,
          });
        }
        break;
      case "datetime":
        if (typeof value !== "string" || !isValidDateTimeString(value)) {
          issues.push({
            message: `Expected to match ISO format: received ${String(value)}`,
            path,
          });
        }
        break;
      case "time":
        if (typeof value !== "string" || !regex.time.test(value)) {
          issues.push({
            message: `Expected to match "HH:mm" format: received ${String(value)}`,
            path,
          });
        }
        break;
      case "decimal":
        if (typeof value !== "string" || !regex.decimal.test(value)) {
          issues.push({
            message: `Expected a decimal string: received ${String(value)}`,
            path,
          });
        }
        break;

      case "enum":
        if (field._metadata.allowedValues) {
          const allowedValues = field._metadata.allowedValues.map((v) => v.value);
          if (typeof value !== "string" || !allowedValues.includes(value)) {
            issues.push({
              message: `Must be one of [${allowedValues.join(", ")}]: received ${String(value)}`,
              path,
            });
          }
        }
        break;

      case "nested":
        // Validate nested object fields
        // runtime value may not match the declared type
        // oxlint-disable typescript/no-unnecessary-condition
        if (
          typeof value !== "object" ||
          value === null ||
          Array.isArray(value) ||
          value instanceof Date
        ) {
          // oxlint-enable typescript/no-unnecessary-condition
          issues.push({
            message: `Expected an object: received ${String(value)}`,
            path,
          });
        } else if (Object.keys(field.fields).length > 0) {
          for (const [fieldName, nestedField] of Object.entries(field.fields)) {
            const fieldValue = (value as Record<string, unknown>)[fieldName];
            const result = nestedField._parseInternal({
              value: fieldValue,
              data,
              invoker,
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

        if (!fn({ value, data, invoker })) {
          issues.push({
            message,
            path,
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
    const { value, data, invoker, pathArray } = args;
    const issues: StandardSchemaV1.Issue[] = [];
    const path = pathArray.length > 0 ? pathArray : undefined;

    // 1. Check required/optional
    const isNullOrUndefined = value === null || value === undefined;
    if (field._metadata.required && isNullOrUndefined) {
      issues.push({
        message: "Required field is missing",
        path,
      });
      return { issues };
    }

    // If optional and null/undefined, skip further validation and normalize to null
    if (!field._metadata.required && isNullOrUndefined) {
      return { value: value ?? null };
    }

    // 2. Check array type
    if (field._metadata.array) {
      if (!Array.isArray(value)) {
        issues.push({
          message: "Expected an array",
          path,
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
          invoker,
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
    const valueIssues = validateValue({ value, data, invoker, pathArray });
    issues.push(...valueIssues);

    if (issues.length > 0) {
      return { issues };
    }

    return { value };
  }

  /**
   * Clone the field and apply metadata updates to the clone.
   * The original instance is never mutated, so a field shared across places
   * cannot leak metadata between them.
   * @param metadataUpdates - Metadata properties to overwrite on the clone
   * @returns A new field with the updated metadata
   */
  function cloneWith(metadataUpdates: Partial<FieldMetadata>) {
    const cloned = field.clone();
    Object.assign(cloned._metadata, metadataUpdates);
    return cloned;
  }

  const field: TailorFieldRuntime<
    { type: T; array: TOptions extends { array: true } ? true : false },
    FieldValue
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
      // Clone-on-write so a shared field instance never leaks metadata.
      return cloneWith({ description });
    },

    typeName(typeName: string) {
      // Clone-on-write so a shared field instance never leaks metadata.
      return cloneWith({ typeName });
    },

    validate(...validateInputs: FieldValidateInput<FieldValue>[]) {
      // Clone-on-write so a shared field instance never leaks metadata.
      return cloneWith({ validate: validateInputs });
    },

    parse(args: FieldParseArgs): StandardSchemaV1.Result<FieldOutput<OutputBase, TOptions>> {
      return parseInternal({
        value: args.value,
        data: args.data,
        invoker: args.invoker,
        pathArray: [],
      });
    },

    _parseInternal: parseInternal,

    clone() {
      // Deep clone nested object fields so the new instance shares no mutable state.
      let clonedFields = fields;
      if (fields) {
        const cloned: Record<string, TailorAnyField> = {};
        for (const [key, nestedField] of Object.entries(fields)) {
          // Both t.* and db.* fields carry clone() at runtime (see CloneableField).
          cloned[key] = (nestedField as TailorAnyField & CloneableField).clone();
        }
        clonedFields = cloned;
      }

      // Rebuild via the factory, handing it this field's metadata so the new
      // parseInternal/validateValue closures rebind to the clone and the factory
      // owns the metadata deep-copy.
      // oxlint-disable-next-line no-explicit-any
      return createTailorField(type, options, clonedFields, values, this._metadata) as any;
    },
  };

  return field;
}

/**
 * Create a UUID field for resolver input/output.
 * @param options - Field configuration options
 * @returns A UUID field
 * @example t.uuid()
 */
function uuid<const Opt extends FieldOptions>(options?: Opt) {
  return createTailorField("uuid", options);
}

/**
 * Create a string field for resolver input/output.
 * @param options - Field configuration options
 * @returns A string field
 * @example t.string()
 * @example t.string({ optional: true })
 * @example t.string({ array: true })
 */
function string<const Opt extends FieldOptions>(options?: Opt) {
  return createTailorField("string", options);
}

/**
 * Create a boolean field for resolver input/output.
 * @param options - Field configuration options
 * @returns A boolean field
 * @example t.bool()
 */
function bool<const Opt extends FieldOptions>(options?: Opt) {
  return createTailorField("boolean", options);
}

/**
 * Create an integer field for resolver input/output.
 * @param options - Field configuration options
 * @returns An integer field
 * @example t.int()
 */
function int<const Opt extends FieldOptions>(options?: Opt) {
  return createTailorField("integer", options);
}

/**
 * Create a float field for resolver input/output.
 * @param options - Field configuration options
 * @returns A float field
 * @example t.float()
 */
function float<const Opt extends FieldOptions>(options?: Opt) {
  return createTailorField("float", options);
}

/**
 * Create a decimal field for resolver input/output (stored as string for precision).
 * @param options - Field configuration options
 * @returns A decimal field
 * @example t.decimal()
 * @example t.decimal({ optional: true })
 */
function decimal<const Opt extends FieldOptions>(options?: Opt) {
  return createTailorField("decimal", options);
}

/**
 * Create a date field for resolver input/output.
 * @param options - Field configuration options
 * @returns A date field
 * @example t.date()
 */
function date<const Opt extends FieldOptions>(options?: Opt) {
  return createTailorField("date", options);
}

/**
 * Create a datetime field for resolver input/output.
 * Format: RFC 3339 date-time, such as "yyyy-MM-ddTHH:mm:ssZ" or
 * "yyyy-MM-ddTHH:mm:ss+09:00".
 * @param options - Field configuration options
 * @returns A datetime field
 * @example t.datetime()
 */
function datetime<const Opt extends FieldOptions>(options?: Opt) {
  return createTailorField("datetime", options);
}

/**
 * Create a time field for resolver input/output.
 * @param options - Field configuration options
 * @returns A time field
 * @example t.time()
 */
function time<const Opt extends FieldOptions>(options?: Opt) {
  return createTailorField("time", options);
}

/**
 * Create an enum field for resolver input/output.
 * @param values - Array of allowed string values
 * @param options - Field configuration options
 * @returns An enum field
 * @example t.enum(["active", "inactive"])
 */
function _enum<const V extends AllowedValues, const Opt extends FieldOptions>(
  values: V,
  options?: Opt,
): TailorField<
  { type: "enum"; array: Opt extends { array: true } ? true : false },
  FieldOutput<AllowedValuesOutput<V>, Opt>
> {
  return createTailorField<"enum", Opt, AllowedValuesOutput<V>>("enum", options, undefined, values);
}

/**
 * Create a nested object field for resolver input/output.
 * @param fields - Record of field definitions
 * @param options - Field options (optional, array)
 * @returns A nested object field
 * @example
 * // Single object:
 * output: t.object({ name: t.string(), email: t.string() })
 * @example
 * // Array of objects:
 * items: t.object({ name: t.string() }, { array: true })
 */
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
  decimal,
  date,
  datetime,
  time,
  enum: _enum,
  object,
};
