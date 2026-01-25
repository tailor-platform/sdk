import {
  type AllowedValues,
  type AllowedValuesOutput,
  mapAllowedValues,
} from "@/configure/types/field";
import { type TailorField, type TailorAnyField, TAILOR_FIELD_BRAND } from "@/configure/types/type";
import {
  type FieldOptions,
  type FieldOutput,
  type TailorFieldType,
  type TailorToTs,
} from "@/configure/types/types";
import {
  type TailorDBTypeMetadata,
  type RawPermissions,
  type RawRelationConfig,
  type RelationType,
} from "@/parser/service/tailordb/types";
import { type TailorTypeGqlPermission, type TailorTypePermission } from "./permission";
import {
  type DBFieldMetadata,
  type DefinedDBFieldMetadata,
  type Hooks,
  type Hook,
  type SerialConfig,
  type IndexDef,
  type TypeFeatures,
  type ExcludeNestedDBFields,
} from "./types";
import type { InferredAttributeMap, TailorUser } from "@/configure/types";
import type { Prettify, output, InferFieldsOutput } from "@/configure/types/helpers";
import type { FieldValidateInput, ValidateConfig, Validators } from "@/configure/types/validation";
import type { StandardSchemaV1 } from "@standard-schema/spec";

/**
 * Symbol used to brand TailorDBField objects.
 * This enables reliable runtime detection of TailorDBField instances regardless of
 * how they were imported or assigned (variable reassignment, destructuring, etc.)
 */
const TAILOR_DB_FIELD_BRAND = Symbol.for("tailor:tailordb-field");

/**
 * Symbol used to brand TailorDBType objects created by db.type().
 * This enables reliable runtime detection of TailorDBType instances regardless of
 * how they were imported or assigned (variable reassignment, destructuring, etc.)
 */
export const TAILOR_DB_TYPE_BRAND = Symbol.for("tailor:tailordb-type");

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

// Helper alias: DB fields can be arbitrarily nested, so we intentionally keep this loose.
// oxlint-disable-next-line no-explicit-any
export type TailorAnyDBField = TailorDBField<any, any>;

const regex = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  date: /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/,
  time: /^(?<hour>\d{2}):(?<minute>\d{2})$/,
  datetime:
    /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(.(?<millisec>\d{3}))?Z$/,
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
 * TailorDBField interface representing a database field with extended metadata.
 * Extends TailorField with database-specific features like relations, indexes, and hooks.
 */
export interface TailorDBField<Defined extends DefinedDBFieldMetadata, Output> extends Omit<
  TailorField<Defined, Output, DBFieldMetadata, Defined["type"]>,
  "description" | "validate"
> {
  /** Brand symbol for type identification */
  readonly [TAILOR_DB_FIELD_BRAND]: true;
  /** Returns a shallow copy of the raw relation config if set */
  readonly rawRelation: Readonly<RawRelationConfig> | undefined;

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
  ): TailorDBField<Prettify<CurrentDefined & { description: true }>, Output>;

  /**
   * Define a relation to another type
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
   * Add hooks for create/update operations
   */
  hooks<CurrentDefined extends Defined, const H extends Hook<unknown, Output>>(
    this: CurrentDefined extends { hooks: unknown }
      ? never
      : CurrentDefined extends { type: "nested" }
        ? never
        : TailorDBField<CurrentDefined, Output>,
    hooks: H,
  ): TailorDBField<
    Prettify<
      CurrentDefined & {
        hooks?: {
          create: H extends { create: unknown } ? true : false;
          update: H extends { update: unknown } ? true : false;
        };
        serial: false;
      }
    >,
    Output
  >;

  /**
   * Add validation functions to the field
   */
  validate<CurrentDefined extends Defined>(
    this: CurrentDefined extends { validate: unknown }
      ? never
      : TailorDBField<CurrentDefined, Output>,
    ...validate: FieldValidateInput<Output>[]
  ): TailorDBField<Prettify<CurrentDefined & { validate: true }>, Output>;

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
   * @param options - Optional field options to override
   * @returns A new TailorDBField instance with the same configuration
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
 * Creates a new TailorDBField instance.
 * @param type - Field type
 * @param options - Field options
 * @param fields - Nested fields for object-like types
 * @param values - Allowed values for enum-like fields
 * @returns A new TailorDBField
 */
function createTailorDBField<
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

  const field: FieldType = {
    [TAILOR_FIELD_BRAND]: true,
    [TAILOR_DB_FIELD_BRAND]: true,
    type,
    fields: (fields ?? {}) as Record<string, TailorAnyField>,
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

    // TailorDBField specific methods
    relation(config: RelationConfig<RelationType, TailorDBType> | RelationSelfConfig) {
      // Store raw relation config - all processing happens in parser layer
      const targetType = isRelationSelfConfig(config) ? "self" : config.toward.type.name;
      _rawRelation = {
        type: config.type,
        toward: {
          type: targetType,
          as: config.toward.as,
          key: config.toward.key,
        },
        backward: config.backward,
      };
      // oxlint-disable-next-line no-explicit-any
      return this as any;
    },

    index() {
      this._metadata.index = true;
      // oxlint-disable-next-line no-explicit-any
      return this as any;
    },

    unique() {
      this._metadata.unique = true;
      this._metadata.index = true;
      // oxlint-disable-next-line no-explicit-any
      return this as any;
    },

    vector() {
      this._metadata.vector = true;
      // oxlint-disable-next-line no-explicit-any
      return this as any;
    },

    hooks(hooks: Hook<unknown, FieldOutput<OutputBase, TOptions>>) {
      this._metadata.hooks = hooks;
      // oxlint-disable-next-line no-explicit-any
      return this as any;
    },

    serial(config: SerialConfig) {
      this._metadata.serial = config;
      // oxlint-disable-next-line no-explicit-any
      return this as any;
    },

    clone(cloneOptions?: FieldOptions) {
      // Create a new field with the same configuration
      const clonedField = createTailorDBField(type, options, fields, values);

      // Copy metadata
      Object.assign(clonedField._metadata, this._metadata);

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
        // Access the internal _rawRelation of the cloned field
        // We need to call relation method to set it
        const clonedRawRelation = { ..._rawRelation, toward: { ..._rawRelation.toward } };
        // @ts-expect-error - Accessing internal state for cloning
        clonedField._setRawRelation(clonedRawRelation);
      }

      // oxlint-disable-next-line no-explicit-any
      return clonedField as any;
    },

    // Internal method for clone to set rawRelation
    // @ts-expect-error - Internal method
    _setRawRelation(relation: RawRelationConfig) {
      _rawRelation = relation;
    },
  };

  return field;
}

const createField = createTailorDBField;

function uuid<const Opt extends FieldOptions>(options?: Opt) {
  return createField("uuid", options);
}

function string<const Opt extends FieldOptions>(options?: Opt) {
  return createField("string", options);
}

function bool<const Opt extends FieldOptions>(options?: Opt) {
  return createField("boolean", options);
}

function int<const Opt extends FieldOptions>(options?: Opt) {
  return createField("integer", options);
}

function float<const Opt extends FieldOptions>(options?: Opt) {
  return createField("float", options);
}

function date<const Opt extends FieldOptions>(options?: Opt) {
  return createField("date", options);
}

function datetime<const Opt extends FieldOptions>(options?: Opt) {
  return createField("datetime", options);
}

function time<const Opt extends FieldOptions>(options?: Opt) {
  return createField("time", options);
}

function _enum<const V extends AllowedValues, const Opt extends FieldOptions>(
  values: V,
  options?: Opt,
): TailorDBField<
  { type: "enum"; array: Opt extends { array: true } ? true : false },
  FieldOutput<AllowedValuesOutput<V>, Opt>
> {
  return createField<"enum", Opt, AllowedValuesOutput<V>>("enum", options, undefined, values);
}

function object<
  const F extends Record<string, TailorAnyDBField> & ExcludeNestedDBFields<F>,
  const Opt extends FieldOptions,
>(fields: F, options?: Opt) {
  return createField("nested", options, fields) as unknown as TailorDBField<
    { type: "nested"; array: Opt extends { array: true } ? true : false },
    FieldOutput<InferFieldsOutput<F>, Opt>
  >;
}

// Helper alias
// oxlint-disable-next-line no-explicit-any
export type TailorAnyDBType = TailorDBType<any, any>;

/**
 * TailorDBType interface representing a database type definition with fields, permissions, and settings.
 */
export interface TailorDBType<
  // Default kept loose to avoid forcing callers to supply generics.
  // oxlint-disable-next-line no-explicit-any
  Fields extends Record<string, TailorAnyDBField> = any,
  User extends object = InferredAttributeMap,
> {
  /** Brand symbol for type identification */
  readonly [TAILOR_DB_TYPE_BRAND]: true;
  readonly name: string;
  readonly fields: Fields;
  readonly _output: InferFieldsOutput<Fields>;
  _description?: string;

  /** Returns metadata for the type */
  readonly metadata: TailorDBTypeMetadata;

  /**
   * Add hooks for fields
   */
  hooks(hooks: Hooks<Fields>): TailorDBType<Fields, User>;

  /**
   * Add validators for fields
   */
  validate(validators: Validators<Fields>): TailorDBType<Fields, User>;

  /**
   * Configure type features
   */
  features(features: Omit<TypeFeatures, "pluralForm">): TailorDBType<Fields, User>;

  /**
   * Define composite indexes
   */
  indexes(...indexes: IndexDef<TailorDBType<Fields, User>>[]): TailorDBType<Fields, User>;

  /**
   * Define file fields
   */
  files<const F extends string>(
    files: Record<F, string> & Partial<Record<keyof output<TailorDBType<Fields, User>>, never>>,
  ): TailorDBType<Fields, User>;

  /**
   * Set record-level permissions
   */
  permission<
    U extends object = User,
    P extends TailorTypePermission<U, output<TailorDBType<Fields, User>>> = TailorTypePermission<
      U,
      output<TailorDBType<Fields, User>>
    >,
  >(
    permission: P,
  ): TailorDBType<Fields, U>;

  /**
   * Set GraphQL-level permissions
   */
  gqlPermission<
    U extends object = User,
    P extends TailorTypeGqlPermission<U> = TailorTypeGqlPermission<U>,
  >(
    permission: P,
  ): TailorDBType<Fields, U>;

  /**
   * Set type description
   */
  description(description: string): TailorDBType<Fields, User>;

  /**
   * Pick specific fields from the type
   */
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

  /**
   * Omit specific fields from the type
   */
  omitFields<K extends keyof Fields>(keys: K[]): Omit<Fields, K>;
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
function createTailorDBType<
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

  if (options.pluralForm) {
    if (name === options.pluralForm) {
      throw new Error(`The name and the plural form must be different. name=${name}`);
    }
    _settings.pluralForm = options.pluralForm;
  }

  const dbType: TailorDBType<Fields, User> = {
    [TAILOR_DB_TYPE_BRAND]: true,
    name,
    fields,
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
      };
    },

    hooks(hooks: Hooks<Fields>) {
      // `Hooks<Fields>` is strongly typed, but `Object.entries()` loses that information.
      // oxlint-disable-next-line no-explicit-any
      Object.entries(hooks).forEach(([fieldName, fieldHooks]: [string, any]) => {
        this.fields[fieldName].hooks(fieldHooks);
      });
      return this;
    },

    validate(validators: Validators<Fields>) {
      Object.entries(validators).forEach(([fieldName, fieldValidators]) => {
        const field = this.fields[fieldName] as TailorAnyDBField;

        const validators = fieldValidators as
          | FieldValidateInput<unknown>
          | FieldValidateInput<unknown>[];

        const isValidateConfig = (v: unknown): v is ValidateConfig<unknown> => {
          return Array.isArray(v) && v.length === 2 && typeof v[1] === "string";
        };

        if (Array.isArray(validators)) {
          if (isValidateConfig(validators)) {
            field.validate(validators);
          } else {
            field.validate(...validators);
          }
        } else {
          field.validate(validators);
        }
      });
      return this;
    },

    features(features: Omit<TypeFeatures, "pluralForm">) {
      _settings = { ..._settings, ...features };
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
      _permissions.record = permission;
      return ret;
    },

    gqlPermission<
      U extends object = User,
      P extends TailorTypeGqlPermission<U> = TailorTypeGqlPermission<U>,
    >(permission: P) {
      const ret = this as TailorDBType<Fields, U>;
      _permissions.gql = permission;
      return ret;
    },

    description(description: string) {
      _description = description;
      this._description = description;
      return this;
    },

    pickFields<K extends keyof Fields, const Opt extends FieldOptions>(keys: K[], options: Opt) {
      const result = {} as Record<K, TailorAnyDBField>;
      for (const key of keys) {
        if (options) {
          result[key] = this.fields[key].clone(options);
        } else {
          result[key] = this.fields[key];
        }
      }
      return result as {
        [P in K]: Fields[P] extends TailorDBField<infer D, infer _O>
          ? TailorDBField<
              Omit<D, "array"> & {
                array: Opt extends { array: true } ? true : D["array"];
              },
              FieldOutput<TailorToTs[D["type"]], Opt>
            >
          : never;
      };
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
  };

  return dbType;
}

export type TailorDBInstance<
  // Default kept loose for convenience; callers still get fully inferred types from `db.type()`.
  // oxlint-disable-next-line no-explicit-any
  Fields extends Record<string, TailorAnyDBField> = any,
  User extends object = InferredAttributeMap,
> = TailorDBType<Fields, User>;

const idField = uuid();
type idField = typeof idField;
type DBType<F extends { id?: never } & Record<string, TailorAnyDBField>> = TailorDBInstance<
  { id: idField } & F
>;

/**
 * Creates a new database type with the specified fields
 * @param name - The name of the type, or a tuple of [name, pluralForm]
 * @param fields - The field definitions for the type
 * @returns A new TailorDBType instance
 */
function dbType<const F extends { id?: never } & Record<string, TailorAnyDBField>>(
  name: string | [string, string],
  fields: F,
): DBType<F>;
/**
 * Creates a new database type with the specified fields and description
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

export const db = {
  type: dbType,
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
  fields: {
    timestamps: () => ({
      createdAt: datetime()
        .hooks({ create: () => new Date() })
        .description("Record creation timestamp"),
      updatedAt: datetime({ optional: true })
        .hooks({ update: () => new Date() })
        .description("Record last update timestamp"),
    }),
  },
};
