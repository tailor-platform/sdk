import { cloneDeep } from "es-toolkit";
import {
  type AllowedValues,
  type AllowedValuesOutput,
  mapAllowedValues,
} from "@/configure/types/field";
import { brandValue } from "@/utils/brand";
import type { TailorTypeGqlPermission, TailorTypePermission } from "./permission";
import type { ExcludeNestedDBFields, RecordHook, TypeFeatures } from "./types";
import type { FieldOptions, FieldOutput, TailorFieldType, TailorToTs } from "@/types/field-types";
import type { output, InferFieldsOutput, Prettify } from "@/types/helpers";
import type { PluginAttachment, PluginConfigs } from "@/types/plugin";
import type {
  TailorDBField as TailorDBFieldBase,
  TailorDBType as TailorDBTypeBase,
} from "@/types/tailor-db-field";
import type { TailorField as TailorFieldMinimal } from "@/types/tailor-field";
import type {
  DBFieldMetadata,
  DefinedDBFieldMetadata,
  SerialConfig,
  IndexDef,
  TailorDBTypeMetadata,
  RawRelationConfig,
  RelationType,
} from "@/types/tailordb";
import type { RawPermissions } from "@/types/tailordb.generated";
import type { InferredAttributeMap, TailorUser } from "@/types/user";
import type { RecordValidateInput, RecordValidators } from "@/types/validation";
import type { StandardSchemaV1 } from "@standard-schema/spec";

/**
 * Distinguishes a single `[fn, message]` tuple from an array of record validators.
 * A config tuple has exactly 2 elements where the second is a string.
 * @param value - Potential validators array or tuple
 * @returns True if the value is a single `[fn, message]` tuple
 */
function isRecordValidateConfig(value: readonly unknown[]): boolean {
  return value.length === 2 && typeof value[1] === "string" && typeof value[0] === "function";
}

// Helper alias: DB fields can be arbitrarily nested, so we intentionally keep this loose.
// oxlint-disable-next-line no-explicit-any
export type TailorAnyDBField = TailorDBField<any, any>;

// Helper alias
// oxlint-disable-next-line no-explicit-any
export type TailorAnyDBType = TailorDBType<any, any>;

/**
 * Full TailorDBField interface with builder methods.
 * Extends the minimal structural interface from types/ with fluent API methods.
 *
 * NOTE: Field-level `hooks` and `validate` have been removed from the public API.
 * Configure them at the record level via `db.type(...).hooks(...) / .validate(...)`
 * or via the third `options` argument of `createTable`.
 */
export interface TailorDBField<
  Defined extends DefinedDBFieldMetadata = DefinedDBFieldMetadata,
  // oxlint-disable-next-line no-explicit-any
  Output = any,
> extends Omit<TailorDBFieldBase<Defined, Output>, "fields"> {
  readonly fields: Record<string, TailorAnyDBField>;
  _metadata: DBFieldMetadata;

  /**
   * Parse and validate a value against this field's validation rules
   */
  parse(args: FieldParseArgs): StandardSchemaV1.Result<Output>;

  /**
   * Internal parse method that tracks field path for nested validation
   * @private
   */
  _parseInternal(args: FieldParseInternalArgs): StandardSchemaV1.Result<Output>;

  /**
   * Field-level `validate` has been removed from the public TailorDB API.
   * Configure validation at the record level via
   * `db.type(...).validate(...)` or the third `options` argument of `createTable`.
   */
  validate(this: never, ...args: never[]): never;

  /**
   * typeName is not available on TailorDB fields.
   * Use typeName on pipeline fields (t.enum / t.object) instead.
   */
  typeName(this: never, typeName: string): never;

  /**
   * Set a description for the field
   */
  description<CurrentDefined extends Defined>(
    this: CurrentDefined extends { description: unknown }
      ? never
      : TailorFieldMinimal<CurrentDefined, Output>,
    description: string,
  ): TailorDBField<Prettify<CurrentDefined & { description: true }>, Output>;

  /**
   * Define a relation to another type.
   */
  relation<S extends RelationType, T extends TailorAnyDBType, CurrentDefined extends Defined>(
    this: CurrentDefined extends { relation: unknown }
      ? never
      : TailorDBField<CurrentDefined, Output>,
    config: RelationConfig<S, T>,
  ): TailorDBField<
    S extends "oneToOne" | "1-1"
      ? Prettify<CurrentDefined & { unique: true; index: true; relation: true }>
      : Prettify<CurrentDefined & { index: true; relation: true }>,
    Output
  >;

  /**
   * Define a self-referencing relation
   */
  relation<S extends RelationSelfConfig, CurrentDefined extends Defined>(
    this: CurrentDefined extends { relation: unknown }
      ? never
      : TailorDBField<CurrentDefined, Output>,
    config: S,
  ): TailorDBField<
    S["type"] extends "oneToOne" | "1-1"
      ? Prettify<CurrentDefined & { unique: true; index: true; relation: true }>
      : Prettify<CurrentDefined & { index: true; relation: true }>,
    Output
  >;

  /**
   * Add an index to the field
   */
  index<CurrentDefined extends Defined>(
    this: CurrentDefined extends { index: unknown }
      ? never
      : CurrentDefined extends { array: true }
        ? never
        : TailorDBField<CurrentDefined, Output>,
  ): TailorDBField<Prettify<CurrentDefined & { index: true }>, Output>;

  /**
   * Make the field unique (also adds an index)
   */
  unique<CurrentDefined extends Defined>(
    this: CurrentDefined extends { unique: unknown }
      ? never
      : CurrentDefined extends { array: true }
        ? never
        : TailorDBField<CurrentDefined, Output>,
  ): TailorDBField<Prettify<CurrentDefined & { unique: true; index: true }>, Output>;

  /**
   * Enable vector search on the field (string type only)
   */
  vector<CurrentDefined extends Defined>(
    this: CurrentDefined extends { vector: unknown }
      ? never
      : CurrentDefined extends { type: "string"; array: false }
        ? TailorDBField<CurrentDefined, Output>
        : never,
  ): TailorDBField<Prettify<CurrentDefined & { vector: true }>, Output>;

  /**
   * Configure serial/auto-increment behavior
   */
  serial<CurrentDefined extends Defined>(
    this: CurrentDefined extends { serial: unknown }
      ? never
      : Output extends null
        ? never
        : CurrentDefined extends { type: "integer" | "string"; array: false }
          ? TailorDBField<CurrentDefined, Output>
          : never,
    config: SerialConfig<CurrentDefined["type"] & ("integer" | "string")>,
  ): TailorDBField<
    Prettify<
      CurrentDefined & {
        serial: true;
        hooks: { create: false; update: false };
      }
    >,
    Output
  >;

  /**
   * Clone the field with optional overrides for field options
   */
  clone<const NewOpt extends FieldOptions>(
    options?: NewOpt,
  ): TailorDBField<
    Prettify<
      Omit<Defined, "array"> & {
        array: NewOpt extends { array: true } ? true : Defined["array"];
      }
    >,
    FieldOutput<TailorToTs[Defined["type"]], NewOpt>
  >;
}

/**
 * Full TailorDBType interface with builder methods.
 * Extends the minimal structural interface from types/ with fluent API methods.
 */
export interface TailorDBType<
  // oxlint-disable-next-line no-explicit-any
  Fields extends Record<string, TailorAnyDBField> = any,
  User extends object = InferredAttributeMap,
> extends TailorDBTypeBase<Fields, User> {
  _description?: string;

  /**
   * Add record-level create/update hooks. Each callback receives `{ data, user }`
   * and returns an object containing only the fields to override on the record.
   * Unchanged fields can be omitted; their incoming values are preserved.
   */
  hooks(hooks: RecordHook<InferFieldsOutput<Fields>>): TailorDBType<Fields, User>;

  /**
   * Add record-level validators. Each callback receives `{ data, user }` and must
   * return `true` for a valid record. Use the tuple form `[fn, message]` for
   * diagnosable error messages.
   */
  validate(validators: RecordValidators<InferFieldsOutput<Fields>>): TailorDBType<Fields, User>;

  features(features: Omit<TypeFeatures, "pluralForm">): TailorDBType<Fields, User>;
  indexes(...indexes: IndexDef<TailorDBType<Fields, User>>[]): TailorDBType<Fields, User>;
  files<const F extends string>(
    files: Record<F, string> & Partial<Record<keyof output<TailorDBType<Fields, User>>, never>>,
  ): TailorDBType<Fields, User>;
  permission<
    U extends object = User,
    P extends TailorTypePermission<U, output<TailorDBType<Fields, User>>> = TailorTypePermission<
      U,
      output<TailorDBType<Fields, User>>
    >,
  >(
    permission: P,
  ): TailorDBType<Fields, U>;
  gqlPermission<
    U extends object = User,
    P extends TailorTypeGqlPermission<U> = TailorTypeGqlPermission<U>,
  >(
    permission: P,
  ): TailorDBType<Fields, U>;
  description(description: string): TailorDBType<Fields, User>;
  pickFields<K extends keyof Fields>(keys: K[]): Pick<Fields, K>;
  pickFields<K extends keyof Fields, const Opt extends FieldOptions>(
    keys: K[],
    options: Opt,
  ): {
    [P in K]: Fields[P] extends TailorDBField<infer D, infer _O>
      ? TailorDBField<
          Omit<D, "array"> & {
            array: Opt extends { array: true } ? true : D["array"];
          },
          FieldOutput<TailorToTs[D["type"]], Opt>
        >
      : never;
  };
  omitFields<K extends keyof Fields>(keys: K[]): Omit<Fields, K>;

  /** Plugin attachments for this type */
  readonly plugins: PluginAttachment[];

  plugin<P extends keyof PluginConfigs<keyof Fields & string>>(config: {
    [K in P]: PluginConfigs<keyof Fields & string>[K];
  }): TailorDBType<Fields, User>;
}

export type TailorDBInstance<
  // oxlint-disable-next-line no-explicit-any
  Fields extends Record<string, TailorAnyDBField> = any,
  User extends object = InferredAttributeMap,
> = TailorDBType<Fields, User>;

interface RelationConfig<S extends RelationType, T extends TailorDBType> {
  type: S;
  toward: {
    type: T;
    as?: string;
    key?: keyof T["fields"] & string;
  };
  backward?: string;
}

// Special config variant for self-referencing relations
type RelationSelfConfig = {
  type: RelationType;
  toward: {
    type: "self";
    as?: string;
    key?: string;
  };
  backward?: string;
};

function isRelationSelfConfig(
  config: RelationConfig<RelationType, TailorDBType> | RelationSelfConfig,
): config is RelationSelfConfig {
  return config.toward.type === "self";
}

const regex = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  date: /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/,
  time: /^(?<hour>\d{2}):(?<minute>\d{2})$/,
  datetime:
    /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(.(?<millisec>\d{3}))?Z$/,
  decimal: /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/,
} as const;

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
 * Creates a new TailorDBField instance.
 * @param type - Field type
 * @param options - Field options
 * @param fields - Nested fields for object-like types
 * @param values - Allowed values for enum-like fields
 * @returns A new TailorDBField
 */
export function createTailorDBField<
  const T extends TailorFieldType,
  const TOptions extends FieldOptions,
  const OutputBase = TailorToTs[T],
>(
  type: T,
  options?: TOptions,
  fields?: Record<string, TailorAnyDBField>,
  values?: AllowedValues,
): TailorDBField<
  { type: T; array: TOptions extends { array: true } ? true : false },
  FieldOutput<OutputBase, TOptions>
> {
  type FieldType = TailorDBField<
    { type: T; array: TOptions extends { array: true } ? true : false },
    FieldOutput<OutputBase, TOptions>
  >;

  const _metadata: DBFieldMetadata = { required: true };
  let _rawRelation: RawRelationConfig | undefined;

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
      case "decimal":
        if (typeof value !== "string" || !regex.decimal.test(value)) {
          issues.push({
            message: `Expected a decimal string: received ${String(value)}`,
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

    // If optional and null/undefined, skip further validation and normalize to null
    if (!field._metadata.required && isNullOrUndefined) {
      return { value: value ?? null };
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

  function cloneWith(metadataUpdates: Partial<DBFieldMetadata>) {
    const cloned = field.clone();
    Object.assign(cloned._metadata, metadataUpdates);
    return cloned;
  }

  const field: FieldType = {
    type,
    fields: (fields ?? {}) as Record<string, TailorAnyDBField>,
    _defined: undefined as unknown as {
      type: T;
      array: TOptions extends { array: true } ? true : false;
    },
    _output: undefined as FieldOutput<OutputBase, TOptions>,
    _metadata,

    get metadata() {
      return { ...this._metadata };
    },

    get rawRelation(): Readonly<RawRelationConfig> | undefined {
      return _rawRelation ? { ..._rawRelation, toward: { ..._rawRelation.toward } } : undefined;
    },

    description(description: string) {
      // oxlint-disable-next-line no-explicit-any
      return cloneWith({ description }) as any;
    },

    // oxlint-disable-next-line no-explicit-any
    typeName: ((typeName: string) => cloneWith({ typeName })) as any,

    // Field-level `validate` has been removed. The stub throws to surface the mistake
    // at runtime even though the `this: never` signature prevents type-level calls.
    // oxlint-disable-next-line no-explicit-any
    validate: (() => {
      throw new Error(
        "Field-level `.validate()` has been removed. Use `db.type(...).validate(...)` or the third `options` argument of `createTable` instead.",
      );
      // oxlint-disable-next-line no-explicit-any
    }) as any,

    parse(args: FieldParseArgs): StandardSchemaV1.Result<FieldOutput<OutputBase, TOptions>> {
      return parseInternal({
        value: args.value,
        data: args.data,
        user: args.user,
        pathArray: [],
      });
    },

    _parseInternal: parseInternal,

    // TailorDBField specific methods
    relation(config: RelationConfig<RelationType, TailorDBType> | RelationSelfConfig) {
      const cloned = field.clone();
      const targetType = isRelationSelfConfig(config) ? "self" : config.toward.type.name;
      // oxlint-disable-next-line no-explicit-any
      (cloned as any)._setRawRelation({
        type: config.type,
        toward: {
          type: targetType,
          as: config.toward.as,
          key: config.toward.key,
        },
        backward: config.backward,
      });
      // oxlint-disable-next-line no-explicit-any
      return cloned as any;
    },

    index() {
      // oxlint-disable-next-line no-explicit-any
      return cloneWith({ index: true }) as any;
    },

    unique() {
      // oxlint-disable-next-line no-explicit-any
      return cloneWith({ unique: true, index: true }) as any;
    },

    vector() {
      // oxlint-disable-next-line no-explicit-any
      return cloneWith({ vector: true }) as any;
    },

    serial(config: SerialConfig) {
      // oxlint-disable-next-line no-explicit-any
      return cloneWith({ serial: config }) as any;
    },

    clone(cloneOptions?: FieldOptions) {
      // Deep clone nested object fields if present
      let clonedFields = fields;
      if (fields) {
        const cloned: Record<string, TailorAnyDBField> = {};
        for (const [key, field] of Object.entries(fields)) {
          cloned[key] = field.clone();
        }
        clonedFields = cloned;
      }

      // Create a new field with cloned configuration
      const clonedField = createTailorDBField(type, options, clonedFields, values);

      // Deep copy metadata using cloneDeep (preserves function references)
      Object.assign(clonedField._metadata, cloneDeep(this._metadata));

      // Apply new options if provided
      if (cloneOptions) {
        if (cloneOptions.optional !== undefined) {
          clonedField._metadata.required = !cloneOptions.optional;
        }
        if (cloneOptions.array !== undefined) {
          clonedField._metadata.array = cloneOptions.array;
        }
      }

      // Copy raw relation if exists
      if (_rawRelation) {
        const clonedRawRelation = cloneDeep(_rawRelation);
        // oxlint-disable-next-line no-explicit-any
        (clonedField as any)._setRawRelation(clonedRawRelation);
      }

      // oxlint-disable-next-line no-explicit-any
      return clonedField as any;
    },

    // Internal method for clone to set rawRelation
    // @ts-ignore - Internal method not in interface
    _setRawRelation(relation: RawRelationConfig) {
      _rawRelation = relation;
    },
  };

  return field;
}

const createField = createTailorDBField;

/**
 * Create a UUID field.
 * @param options - Field configuration options
 * @returns A UUID field
 * @example db.uuid()
 * @example db.uuid({ optional: true })
 */
function uuid<const Opt extends FieldOptions>(options?: Opt) {
  return createField("uuid", options);
}

/**
 * Create a string field.
 * @param options - Field configuration options
 * @returns A string field
 * @example db.string()
 * @example db.string({ optional: true })
 */
function string<const Opt extends FieldOptions>(options?: Opt) {
  return createField("string", options);
}

/**
 * Create a boolean field.
 * Note: The method name is `bool` but creates a `boolean` type field.
 * @param options - Field configuration options
 * @returns A boolean field
 * @example db.bool()
 * @example db.bool({ optional: true })
 */
function bool<const Opt extends FieldOptions>(options?: Opt) {
  return createField("boolean", options);
}

/**
 * Create an integer field.
 * @param options - Field configuration options
 * @returns An integer field
 * @example db.int()
 * @example db.int({ optional: true })
 */
function int<const Opt extends FieldOptions>(options?: Opt) {
  return createField("integer", options);
}

/**
 * Create a float (decimal number) field.
 * @param options - Field configuration options
 * @returns A float field
 * @example db.float()
 * @example db.float({ optional: true })
 */
function float<const Opt extends FieldOptions>(options?: Opt) {
  return createField("float", options);
}

interface DecimalFieldOptions extends FieldOptions {
  scale?: number;
}

/**
 * Create a decimal field (stored as string for precision).
 * @param options - Field configuration options including optional scale (0-12)
 * @returns A decimal field
 * @example db.decimal()
 * @example db.decimal({ scale: 2 })
 * @example db.decimal({ scale: 2, optional: true })
 */
function decimal<const Opt extends DecimalFieldOptions>(options?: Opt) {
  if (options?.scale !== undefined) {
    if (!Number.isInteger(options.scale) || options.scale < 0 || options.scale > 12) {
      throw new Error("scale must be an integer between 0 and 12");
    }
  }
  const field = createField("decimal", options);
  if (options?.scale !== undefined) {
    field._metadata.scale = options.scale;
  }
  return field;
}

/**
 * Create a date field (date only, no time component).
 * Format: "yyyy-MM-dd"
 * @param options - Field configuration options
 * @returns A date field
 * @example db.date()
 */
function date<const Opt extends FieldOptions>(options?: Opt) {
  return createField("date", options);
}

/**
 * Create a datetime field (date and time).
 * Format: ISO 8601 "yyyy-MM-ddTHH:mm:ssZ"
 * @param options - Field configuration options
 * @returns A datetime field
 * @example db.datetime()
 */
function datetime<const Opt extends FieldOptions>(options?: Opt) {
  return createField("datetime", options);
}

/**
 * Create a time field (time only, no date component).
 * Format: "HH:mm"
 * @param options - Field configuration options
 * @returns A time field
 * @example db.time()
 */
function time<const Opt extends FieldOptions>(options?: Opt) {
  return createField("time", options);
}

/**
 * Create an enum field with a fixed set of allowed string values.
 * @param values - Array of allowed string values, or array of `{ value, description }` objects
 * @param options - Field configuration options
 * @returns An enum field
 * @example db.enum(["active", "inactive", "suspended"])
 * @example db.enum(["small", "medium", "large"], { optional: true })
 */
function _enum<const V extends AllowedValues, const Opt extends FieldOptions>(
  values: V,
  options?: Opt,
): TailorDBField<
  { type: "enum"; array: Opt extends { array: true } ? true : false },
  FieldOutput<AllowedValuesOutput<V>, Opt>
> {
  return createField<"enum", Opt, AllowedValuesOutput<V>>("enum", options, undefined, values);
}

/**
 * Create a nested object field with sub-fields.
 * @param fields - Record of nested field definitions
 * @param options - Field configuration options
 * @returns A nested object field
 * @example db.object({ street: db.string(), city: db.string(), zip: db.string() })
 * @example db.object({ name: db.string() }, { optional: true })
 */
function object<
  const F extends Record<string, TailorAnyDBField> & ExcludeNestedDBFields<F>,
  const Opt extends FieldOptions,
>(fields: F, options?: Opt) {
  return createField("nested", options, fields) as unknown as TailorDBField<
    { type: "nested"; array: Opt extends { array: true } ? true : false },
    FieldOutput<InferFieldsOutput<F>, Opt>
  >;
}

/**
 * Creates a new TailorDBType instance.
 * @param name - Type name
 * @param fields - Field definitions
 * @param options - Type options
 * @param options.pluralForm - Optional plural form
 * @param options.description - Optional description
 * @returns A new TailorDBType
 */
export function createTailorDBType<
  // oxlint-disable-next-line no-explicit-any
  const Fields extends Record<string, TailorAnyDBField> = any,
  User extends object = InferredAttributeMap,
>(
  name: string,
  fields: Fields,
  options: { pluralForm?: string; description?: string },
): TailorDBType<Fields, User> {
  let _description = options.description;
  let _settings: TypeFeatures = {};
  let _indexes: IndexDef<TailorDBType<Fields, User>>[] = [];
  const _permissions: RawPermissions = {};
  let _files: Record<string, string> = {};
  const _plugins: PluginAttachment[] = [];
  let _recordHooks: RecordHook<InferFieldsOutput<Fields>> | undefined;
  let _recordValidators: RecordValidateInput<InferFieldsOutput<Fields>>[] | undefined;

  if (options.pluralForm) {
    if (name === options.pluralForm) {
      throw new Error(`The name and the plural form must be different. name=${name}`);
    }
    _settings.pluralForm = options.pluralForm;
  }

  const dbType: TailorDBType<Fields, User> = {
    name,
    fields: { ...fields },
    _output: null as unknown as InferFieldsOutput<Fields>,
    _description,

    get metadata(): TailorDBTypeMetadata {
      // Convert indexes to the format expected by the manifest
      const indexes: Record<string, { fields: string[]; unique?: boolean }> = {};
      if (_indexes && _indexes.length > 0) {
        _indexes.forEach((index) => {
          const fieldNames = index.fields.map((field) => String(field));
          const key = index.name || `idx_${fieldNames.join("_")}`;
          indexes[key] = {
            fields: fieldNames,
            unique: index.unique,
          };
        });
      }

      return {
        name: this.name,
        description: _description,
        settings: _settings,
        permissions: _permissions,
        files: _files,
        ...(Object.keys(indexes).length > 0 && { indexes }),
        ...(_recordHooks && { hooks: _recordHooks }),
        ...(_recordValidators && { validate: _recordValidators }),
      };
    },

    hooks(hooks: RecordHook<InferFieldsOutput<Fields>>) {
      _recordHooks = hooks;
      return this;
    },

    validate(validators: RecordValidators<InferFieldsOutput<Fields>>) {
      _recordValidators =
        Array.isArray(validators) && !isRecordValidateConfig(validators)
          ? (validators as RecordValidateInput<InferFieldsOutput<Fields>>[])
          : [validators as RecordValidateInput<InferFieldsOutput<Fields>>];
      return this;
    },

    features(features: Omit<TypeFeatures, "pluralForm">) {
      _settings = {
        ..._settings,
        ...features,
      };
      return this;
    },

    indexes(...indexes: IndexDef<TailorDBType<Fields, User>>[]) {
      _indexes = indexes;
      return this;
    },

    files<const F extends string>(
      files: Record<F, string> & Partial<Record<keyof output<TailorDBType<Fields, User>>, never>>,
    ) {
      _files = files;
      return this;
    },

    permission<
      U extends object = User,
      P extends TailorTypePermission<U, output<TailorDBType<Fields, User>>> = TailorTypePermission<
        U,
        output<TailorDBType<Fields, User>>
      >,
    >(permission: P) {
      const ret = this as TailorDBType<Fields, U>;
      _permissions.record = permission as RawPermissions["record"];
      return ret;
    },

    gqlPermission<
      U extends object = User,
      P extends TailorTypeGqlPermission<U> = TailorTypeGqlPermission<U>,
    >(permission: P) {
      const ret = this as TailorDBType<Fields, U>;
      _permissions.gql = permission as RawPermissions["gql"];
      return ret;
    },

    description(description: string) {
      _description = description;
      this._description = description;
      return this;
    },

    pickFields<K extends keyof Fields, const Opt extends FieldOptions>(keys: K[], options?: Opt) {
      const result = {} as Record<K, TailorAnyDBField>;
      for (const key of keys) {
        if (options) {
          result[key] = this.fields[key].clone(options);
        } else {
          result[key] = this.fields[key];
        }
      }
      // oxlint-disable-next-line no-explicit-any
      return result as any;
    },

    omitFields<K extends keyof Fields>(keys: K[]): Omit<Fields, K> {
      const keysSet = new Set(keys);
      const result = {} as Record<string, TailorAnyDBField>;
      for (const key in this.fields) {
        if (Object.hasOwn(this.fields, key) && !keysSet.has(key as unknown as K)) {
          result[key] = this.fields[key];
        }
      }
      return result as Omit<Fields, K>;
    },

    get plugins(): PluginAttachment[] {
      return _plugins;
    },

    plugin<P extends keyof PluginConfigs<keyof Fields & string>>(config: {
      [K in P]: PluginConfigs<keyof Fields & string>[K];
    }): TailorDBType<Fields, User> {
      for (const [pluginId, pluginConfig] of Object.entries(config)) {
        _plugins.push({ pluginId, config: pluginConfig });
      }
      return this;
    },
  };

  return brandValue(dbType, "tailordb-type");
}

const idField = uuid();
type idField = typeof idField;
type DBType<F extends { id?: never } & Record<string, TailorAnyDBField>> = TailorDBInstance<
  { id: idField } & F
>;

/**
 * Creates a new database type with the specified fields.
 * An `id` field (UUID) is automatically added to every type.
 * @param name - The name of the type, or a tuple of [name, pluralForm]
 * @param fields - The field definitions for the type
 * @returns A new TailorDBType instance
 * @example
 * export const user = db.type("User", {
 *   name: db.string(),
 *   email: db.string(),
 *   age: db.int({ optional: true }),
 *   role: db.enum(["admin", "member"]),
 *   ...db.fields.timestamps(),
 * });
 * // Always export both the value and type:
 * export type user = typeof user;
 */
function dbType<const F extends { id?: never } & Record<string, TailorAnyDBField>>(
  name: string | [string, string],
  fields: F,
): DBType<F>;
/**
 * Creates a new database type with the specified fields and description.
 * An `id` field (UUID) is automatically added to every type.
 * @param name - The name of the type, or a tuple of [name, pluralForm]
 * @param description - A description of the type
 * @param fields - The field definitions for the type
 * @returns A new TailorDBType instance
 */
function dbType<const F extends { id?: never } & Record<string, TailorAnyDBField>>(
  name: string | [string, string],
  description: string,
  fields: F,
): DBType<F>;
function dbType<const F extends { id?: never } & Record<string, TailorAnyDBField>>(
  name: string | [string, string],
  fieldsOrDescription: string | F,
  fields?: F,
): DBType<F> {
  const typeName = Array.isArray(name) ? name[0] : name;
  const pluralForm = Array.isArray(name) ? name[1] : undefined;

  let description: string | undefined;
  let fieldDef: F;
  if (typeof fieldsOrDescription === "string") {
    description = fieldsOrDescription;
    fieldDef = fields as F;
  } else {
    fieldDef = fieldsOrDescription;
  }
  return createTailorDBType<{ id: idField } & F>(
    typeName,
    {
      id: idField,
      ...fieldDef,
    },
    { pluralForm, description },
  ) as DBType<F>;
}

/** TailorDB schema builder utilities for defining types and fields. */
export const db = {
  type: dbType,
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
  fields: {
    /**
     * Creates standard timestamp fields (createdAt, updatedAt).
     * Users must populate these via record-level hooks on `db.type(...).hooks(...)`
     * or via the third `options` argument of `createTable`.
     * @returns An object with createdAt and updatedAt fields
     * @example
     * const model = db.type("Model", {
     *   name: db.string(),
     *   ...db.fields.timestamps(),
     * }).hooks({
     *   create: ({ data }) => ({ ...data, createdAt: new Date() }),
     *   update: ({ data }) => ({ ...data, updatedAt: new Date() }),
     * });
     */
    timestamps: () => {
      const createdAt = datetime().description("Record creation timestamp");
      createdAt._metadata.generated = true;
      const updatedAt = datetime({ optional: true }).description("Record last update timestamp");
      updatedAt._metadata.generated = true;
      return { createdAt, updatedAt };
    },
  },
};
