import { type AllowedValues, type AllowedValuesOutput } from "@/configure/types/field";
import { TailorField } from "@/configure/types/type";
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
import type { InferredAttributeMap } from "@/configure/types";
import type { Prettify, output, InferFieldsOutput } from "@/configure/types/helpers";
import type { FieldValidateInput, ValidateConfig, Validators } from "@/configure/types/validation";

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

export class TailorDBField<
  const Defined extends DefinedDBFieldMetadata,
  const Output,
> extends TailorField<Defined, Output, DBFieldMetadata> {
  private _rawRelation: RawRelationConfig | undefined = undefined;

  get rawRelation(): Readonly<RawRelationConfig> | undefined {
    return this._rawRelation
      ? { ...this._rawRelation, toward: { ...this._rawRelation.toward } }
      : undefined;
  }

  get metadata() {
    return { ...this._metadata };
  }

  private constructor(
    type: TailorFieldType,
    options?: FieldOptions,
    fields?: Record<string, TailorAnyDBField>,
    values?: AllowedValues,
  ) {
    super(type, options, fields, values);
  }

  static create<
    const T extends TailorFieldType,
    const TOptions extends FieldOptions,
    const OutputBase = TailorToTs[T],
  >(
    type: T,
    options?: TOptions,
    fields?: Record<string, TailorAnyDBField>,
    values?: AllowedValues,
  ) {
    return new TailorDBField<
      { type: T; array: TOptions extends { array: true } ? true : false },
      FieldOutput<OutputBase, TOptions>
    >(type, options, fields, values);
  }

  description<CurrentDefined extends Defined>(
    this: CurrentDefined extends { description: unknown }
      ? never
      : TailorField<CurrentDefined, Output>,
    description: string,
  ): TailorDBField<Prettify<CurrentDefined & { description: true }>, Output> {
    // Fluent API: TS can't express the refined return type through the base method.
    // oxlint-disable-next-line no-explicit-any
    return super.description(description) as any;
  }

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

  // Overload: self-referencing variant
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

  // Implementation
  relation<CurrentDefined extends Defined>(
    this: CurrentDefined extends { relation: unknown }
      ? never
      : TailorDBField<CurrentDefined, Output>,
    config: RelationConfig<RelationType, TailorDBType> | RelationSelfConfig,
  ): TailorDBField<DefinedDBFieldMetadata, Output> {
    // Store raw relation config - all processing happens in parser layer
    const targetType = isRelationSelfConfig(config) ? "self" : config.toward.type.name;
    this._rawRelation = {
      type: config.type,
      toward: {
        type: targetType,
        as: config.toward.as,
        key: config.toward.key,
      },
      backward: config.backward,
    };
    return this;
  }

  index<CurrentDefined extends Defined>(
    this: CurrentDefined extends { index: unknown }
      ? never
      : CurrentDefined extends { array: true }
        ? never
        : TailorDBField<CurrentDefined, Output>,
  ) {
    this._metadata.index = true;
    return this as TailorDBField<Prettify<CurrentDefined & { index: true }>, Output>;
  }

  unique<CurrentDefined extends Defined>(
    this: CurrentDefined extends { unique: unknown }
      ? never
      : CurrentDefined extends { array: true }
        ? never
        : TailorDBField<CurrentDefined, Output>,
  ) {
    this._metadata.unique = true;
    this._metadata.index = true;
    return this as TailorDBField<Prettify<CurrentDefined & { unique: true; index: true }>, Output>;
  }

  vector<CurrentDefined extends Defined>(
    this: CurrentDefined extends { vector: unknown }
      ? never
      : CurrentDefined extends { type: "string"; array: false }
        ? TailorDBField<CurrentDefined, Output>
        : never,
  ) {
    this._metadata.vector = true;
    return this as TailorDBField<Prettify<CurrentDefined & { vector: true }>, Output>;
  }

  hooks<CurrentDefined extends Defined, const H extends Hook<unknown, Output>>(
    this: CurrentDefined extends { hooks: unknown }
      ? never
      : CurrentDefined extends { type: "nested" }
        ? never
        : TailorDBField<CurrentDefined, Output>,
    hooks: H,
  ) {
    this._metadata.hooks = hooks;
    return this as TailorDBField<
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
  }

  validate<CurrentDefined extends Defined>(
    this: CurrentDefined extends { validate: unknown }
      ? never
      : TailorDBField<CurrentDefined, Output>,
    ...validate: FieldValidateInput<Output>[]
  ) {
    this._metadata.validate = validate;
    return this as TailorDBField<Prettify<CurrentDefined & { validate: true }>, Output>;
  }

  serial<CurrentDefined extends Defined>(
    this: CurrentDefined extends { serial: unknown }
      ? never
      : Output extends null
        ? never
        : CurrentDefined extends { type: "integer" | "string"; array: false }
          ? TailorDBField<CurrentDefined, Output>
          : never,
    config: SerialConfig<CurrentDefined["type"] & ("integer" | "string")>,
  ) {
    (this as TailorDBField<CurrentDefined, Output>)._metadata.serial = config;
    return this as TailorDBField<
      Prettify<
        CurrentDefined & {
          serial: true;
          hooks: { create: false; update: false };
        }
      >,
      Output
    >;
  }

  /**
   * Clone the field with optional overrides for field options
   * @param {FieldOptions} [options] - Optional field options to override
   * @returns {TailorDBField<unknown, unknown>} A new TailorDBField instance with the same configuration
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
  > {
    // Create a clone using Object.create to preserve prototype chain
    const clonedField = Object.create(Object.getPrototypeOf(this)) as TailorDBField<
      Defined,
      Output
    >;

    // Copy all properties
    Object.assign(clonedField, {
      type: this.type,
      fields: this.fields,
      _defined: this._defined,
      _output: this._output,
    });

    // Clone and merge metadata with new options
    clonedField._metadata = { ...this._metadata };
    if (options) {
      if (options.optional !== undefined) {
        clonedField._metadata.required = !options.optional;
      }
      if (options.array !== undefined) {
        clonedField._metadata.array = options.array;
      }
    }

    // Copy internal state
    if (this._rawRelation) {
      clonedField._rawRelation = {
        ...this._rawRelation,
        toward: { ...this._rawRelation.toward },
      };
    }

    return clonedField as TailorAnyDBField;
  }
}

const createField = TailorDBField.create;
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

export class TailorDBType<
  // Default kept loose to avoid forcing callers to supply generics.
  // oxlint-disable-next-line no-explicit-any
  const Fields extends Record<string, TailorAnyDBField> = any,
  User extends object = InferredAttributeMap,
> {
  public readonly _output = null as unknown as InferFieldsOutput<Fields>;
  public _description?: string;
  private _settings: TypeFeatures = {};
  private _indexes: IndexDef<this>[] = [];
  private _permissions: RawPermissions = {};
  private _files: Record<string, string> = {};

  constructor(
    public readonly name: string,
    public readonly fields: Fields,
    options: { pluralForm?: string; description?: string },
  ) {
    this._description = options.description;

    if (options.pluralForm) {
      if (name === options.pluralForm) {
        throw new Error(`The name and the plural form must be different. name=${name}`);
      }
      this._settings.pluralForm = options.pluralForm;
    }
  }

  get metadata(): TailorDBTypeMetadata {
    // Convert indexes to the format expected by the manifest
    const indexes: Record<string, { fields: string[]; unique?: boolean }> = {};
    if (this._indexes && this._indexes.length > 0) {
      this._indexes.forEach((index) => {
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
      description: this._description,
      settings: this._settings,
      permissions: this._permissions,
      files: this._files,
      ...(Object.keys(indexes).length > 0 && { indexes }),
    };
  }

  hooks(hooks: Hooks<Fields>) {
    // `Hooks<Fields>` is strongly typed, but `Object.entries()` loses that information.
    // oxlint-disable-next-line no-explicit-any
    Object.entries(hooks).forEach(([fieldName, fieldHooks]: [string, any]) => {
      this.fields[fieldName].hooks(fieldHooks);
    });
    return this;
  }

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
  }

  features(features: Omit<TypeFeatures, "pluralForm">) {
    this._settings = { ...this._settings, ...features };
    return this;
  }

  indexes(...indexes: IndexDef<this>[]) {
    this._indexes = indexes;
    return this;
  }

  files<const F extends string>(
    files: Record<F, string> & Partial<Record<keyof output<this>, never>>,
  ) {
    this._files = files;
    return this;
  }

  permission<
    U extends object = User,
    P extends TailorTypePermission<U, output<this>> = TailorTypePermission<U, output<this>>,
  >(permission: P) {
    const ret = this as TailorDBType<Fields, U>;
    ret._permissions.record = permission;
    return ret;
  }

  gqlPermission<
    U extends object = User,
    P extends TailorTypeGqlPermission<U> = TailorTypeGqlPermission<U>,
  >(permission: P) {
    const ret = this as TailorDBType<Fields, U>;
    ret._permissions.gql = permission;
    return ret;
  }

  description(description: string) {
    this._description = description;
    return this;
  }

  /**
   * Pick specific fields from the type
   * @param {(keyof Fields)[]} keys - Array of field keys to pick
   * @param {FieldOptions} options - Optional field options to apply to picked fields
   * @returns {Record<string, TailorDBField<unknown, unknown>>} An object containing only the specified fields
   */
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
  }

  /**
   * Omit specific fields from the type
   * @template K
   * @param {(keyof Fields)[]} keys - Array of field keys to omit
   * @returns {Omit<Fields, K>} An object containing all fields except the specified ones
   */
  omitFields<K extends keyof Fields>(keys: K[]): Omit<Fields, K> {
    const keysSet = new Set(keys);
    const result = {} as Record<string, TailorAnyDBField>;
    for (const key in this.fields) {
      if (Object.hasOwn(this.fields, key) && !keysSet.has(key as unknown as K)) {
        result[key] = this.fields[key];
      }
    }
    return result as Omit<Fields, K>;
  }
}

export type TailorDBInstance<
  // Default kept loose for convenience; callers still get fully inferred types from `db.type()`.
  // oxlint-disable-next-line no-explicit-any
  Fields extends Record<string, TailorAnyDBField> = any,
  User extends object = InferredAttributeMap,
> = InstanceType<typeof TailorDBType<Fields, User>>;

const idField = uuid();
type idField = typeof idField;
type DBType<F extends { id?: never } & Record<string, TailorAnyDBField>> = TailorDBInstance<
  { id: idField } & F
>;

/**
 * Creates a new database type with the specified fields
 * @param {string | [string, string]} name - The name of the type, or a tuple of [name, pluralForm]
 * @param {Record<string, TailorDBField<unknown, unknown>>} fields - The field definitions for the type
 * @returns {DBType<F>} A new TailorDBType instance
 */
function dbType<const F extends { id?: never } & Record<string, TailorAnyDBField>>(
  name: string | [string, string],
  fields: F,
): DBType<F>;
/**
 * Creates a new database type with the specified fields and description
 * @param {string | [string, string]} name - The name of the type, or a tuple of [name, pluralForm]
 * @param {string} description - A description of the type
 * @param {Record<string, TailorDBField<unknown, unknown>>} fields - The field definitions for the type
 * @returns {DBType<F>} A new TailorDBType instance
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
  return new TailorDBType<{ id: idField } & F>(
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
