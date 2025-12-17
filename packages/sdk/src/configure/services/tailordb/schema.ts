import { clone } from "es-toolkit";
import { type InferredAttributeMap, tailorUserMap } from "@/configure/types";
import {
  type AllowedValues,
  type AllowedValuesOutput,
} from "@/configure/types/field";
import { type OperatorFieldConfig } from "@/configure/types/operator";
import { TailorField } from "@/configure/types/type";
import {
  type FieldOptions,
  type FieldOutput,
  type TailorFieldType,
  type TailorToTs,
} from "@/configure/types/types";
import { type TailorDBTypeConfig } from "./operator-types";
import {
  type Permissions,
  type TailorTypeGqlPermission,
  type TailorTypePermission,
  normalizePermission,
  normalizeGqlPermission,
} from "./permission";
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
import type {
  Prettify,
  output,
  InferFieldsOutput,
} from "@/configure/types/helpers";
import type {
  FieldValidateInput,
  ValidateConfig,
  Validators,
} from "@/configure/types/validation";

type RelationType =
  | "oneToOne"
  | "1-1"
  | "manyToOne"
  | "n-1"
  | "N-1"
  | "keyOnly";

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

interface PendingSelfRelation {
  type: RelationType;
  as?: string;
  key: string;
  backward: string;
}

function isRelationSelfConfig(
  config: RelationConfig<RelationType, TailorDBType> | RelationSelfConfig,
): config is RelationSelfConfig {
  return config.toward.type === "self";
}

interface ReferenceConfig<T extends TailorDBType<any, any>> {
  type: TailorDBType<any, any>;
  key: keyof T["fields"] & string;
  nameMap: [string | undefined, string];
}

/**
 * Convert a function to a string representation.
 * Handles method shorthand syntax (e.g., `create() { ... }`) by converting it to
 * a function expression (e.g., `function create() { ... }`).
 *
 * TODO: This function should be moved to the parser module.
 * The same function exists in `src/cli/apply/services/executor.ts`.
 * These should be unified into a common utility in the parser layer.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
const stringifyFunction = (fn: Function): string => {
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

const convertFnToExpr = (
  fn: NonNullable<Hook<any, any>["create"] | Hook<any, any>["update"]>,
) => {
  const normalized = stringifyFunction(fn);
  return `(${normalized})({ value: _value, data: _data, user: ${tailorUserMap} })`;
};

export class TailorDBField<
  const Defined extends DefinedDBFieldMetadata,
  const Output,
> extends TailorField<Defined, Output, DBFieldMetadata> {
  private _ref: ReferenceConfig<TailorDBType> | undefined = undefined;
  private _pendingSelfRelation: PendingSelfRelation | undefined = undefined;

  get reference(): Readonly<ReferenceConfig<TailorDBType>> | undefined {
    return clone(this._ref);
  }

  get metadata() {
    return { ...this._metadata };
  }

  get config(): OperatorFieldConfig {
    return {
      type: this.type,
      ...this._metadata,
      ...(this.type === "nested" && Object.keys(this.fields).length > 0
        ? {
            fields: Object.entries(this.fields).reduce(
              (acc, [key, field]) => {
                acc[key] = (field as TailorDBField<any, any>).config;
                return acc;
              },
              {} as Record<string, OperatorFieldConfig>,
            ),
          }
        : {}),
      validate: this._metadata.validate?.map((v) => {
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
      hooks: this._metadata.hooks
        ? {
            create: this._metadata.hooks.create
              ? {
                  expr: convertFnToExpr(this._metadata.hooks.create),
                }
              : undefined,
            update: this._metadata.hooks.update
              ? {
                  expr: convertFnToExpr(this._metadata.hooks.update),
                }
              : undefined,
          }
        : undefined,
      serial: this._metadata.serial
        ? {
            start: this._metadata.serial.start,
            maxValue: this._metadata.serial.maxValue,
            format:
              "format" in this._metadata.serial
                ? this._metadata.serial.format
                : undefined,
          }
        : undefined,
    };
  }

  private constructor(
    type: TailorFieldType,
    options?: FieldOptions,
    fields?: Record<string, TailorDBField<any, any>>,
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
    fields?: Record<string, TailorDBField<any, any>>,
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
    return super.description(description) as any;
  }

  relation<
    S extends RelationType,
    T extends TailorDBType<any, any>,
    CurrentDefined extends Defined,
  >(
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
    this._metadata.index = true;
    this._metadata.foreignKey = true;
    this._metadata.unique = ["oneToOne", "1-1"].includes(config.type);

    const key = config.toward.key ?? "id";
    const backward = config.backward ?? "";

    if (isRelationSelfConfig(config)) {
      // Defer resolving the self reference until the type is constructed
      this._pendingSelfRelation = {
        type: config.type,
        as: config.toward.as,
        key,
        backward,
      };
      return this;
    }

    this._metadata.foreignKeyType = config.toward.type.name;
    this._metadata.foreignKeyField = key;
    if (config.type === "keyOnly") {
      return this;
    }

    const forward = config.toward.as;
    this._ref = {
      type: config.toward.type,
      nameMap: [forward, backward],
      key,
    };
    this._metadata.relation = true;
    return this;
  }

  index<CurrentDefined extends Defined>(
    this: CurrentDefined extends { index: unknown }
      ? never
      : TailorDBField<CurrentDefined, Output>,
  ) {
    this._metadata.index = true;
    return this as TailorDBField<
      Prettify<CurrentDefined & { index: true }>,
      Output
    >;
  }

  unique<CurrentDefined extends Defined>(
    this: CurrentDefined extends { unique: unknown }
      ? never
      : TailorDBField<CurrentDefined, Output>,
  ) {
    this._metadata.unique = true;
    this._metadata.index = true;
    return this as TailorDBField<
      Prettify<CurrentDefined & { unique: true; index: true }>,
      Output
    >;
  }

  vector<CurrentDefined extends Defined>(
    this: CurrentDefined extends { vector: unknown }
      ? never
      : CurrentDefined extends { type: "string"; array: false }
        ? TailorDBField<CurrentDefined, Output>
        : never,
  ) {
    this._metadata.vector = true;
    return this as TailorDBField<
      Prettify<CurrentDefined & { vector: true }>,
      Output
    >;
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
    return this as TailorDBField<
      Prettify<CurrentDefined & { validate: true }>,
      Output
    >;
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
  > {
    // Create a clone using Object.create to preserve prototype chain
    const clonedField = Object.create(
      Object.getPrototypeOf(this),
    ) as TailorDBField<Defined, Output>;

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
    if (this._ref) {
      clonedField._ref = clone(this._ref);
    }
    if (this._pendingSelfRelation) {
      clonedField._pendingSelfRelation = { ...this._pendingSelfRelation };
    }

    return clonedField as TailorDBField<any, any>;
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
  return createField<"enum", Opt, AllowedValuesOutput<V>>(
    "enum",
    options,
    undefined,
    values,
  );
}

function object<
  const F extends Record<string, TailorDBField<any, any>> &
    ExcludeNestedDBFields<F>,
  const Opt extends FieldOptions,
>(fields: F, options?: Opt) {
  return createField("nested", options, fields) as unknown as TailorDBField<
    { type: "nested"; array: Opt extends { array: true } ? true : false },
    FieldOutput<InferFieldsOutput<F>, Opt>
  >;
}

export class TailorDBType<
  const Fields extends Record<string, TailorDBField<any, any>> = any,
  User extends object = InferredAttributeMap,
> {
  public readonly _output = null as unknown as InferFieldsOutput<Fields>;
  public _description?: string;
  private _settings: TypeFeatures = {};
  private _indexes: IndexDef<this>[] = [];
  private _permissions: Permissions = {};
  private _files: Record<string, string> = {};

  constructor(
    public readonly name: string,
    public readonly fields: Fields,
    options: { pluralForm?: string; description?: string },
  ) {
    this._description = options.description;

    if (options.pluralForm) {
      if (name === options.pluralForm) {
        throw new Error(
          `The name and the plural form must be different. name=${name}`,
        );
      }
      this._settings.pluralForm = options.pluralForm;
    }

    // Resolve any pending self-references now that the type is constructed
    Object.entries(this.fields).forEach(([fieldName, field]) => {
      const f = field as unknown as {
        _pendingSelfRelation: PendingSelfRelation | undefined;
        _metadata: DBFieldMetadata;
        _ref: ReferenceConfig<TailorDBType<any, any>>;
      };
      const pending = f._pendingSelfRelation;
      if (pending) {
        f._metadata.foreignKeyType = this.name;
        f._metadata.foreignKeyField = pending.key;
        if (pending.type === "keyOnly") {
          return this;
        }

        const forward = pending.as ?? fieldName.replace(/(ID|Id|id)$/u, "");
        // Type conversion for manipulating private _ref.
        f._ref = {
          type: this,
          nameMap: [forward, pending.backward],
          key: pending.key,
        };
      }
    });
  }

  get metadata(): TailorDBTypeConfig {
    const metadataFields = Object.entries(this.fields).reduce(
      (acc, [key, field]) => {
        acc[key] = field.config;
        return acc;
      },
      {} as Record<string, OperatorFieldConfig>,
    );

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
      schema: {
        description: this._description,
        extends: false,
        fields: metadataFields,
        settings: this._settings,
        permissions: this._permissions,
        files: this._files,
        ...(Object.keys(indexes).length > 0 && { indexes }),
      },
    };
  }

  hooks(hooks: Hooks<Fields>) {
    Object.entries(hooks).forEach(([fieldName, fieldHooks]: [string, any]) => {
      this.fields[fieldName].hooks(fieldHooks);
    });
    return this;
  }

  validate(validators: Validators<Fields>) {
    Object.entries(validators).forEach(([fieldName, fieldValidators]) => {
      const field = this.fields[fieldName] as TailorDBField<any, any>;

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
    P extends TailorTypePermission<U, output<this>> = TailorTypePermission<
      U,
      output<this>
    >,
  >(permission: P) {
    const ret = this as TailorDBType<Fields, U>;
    ret._permissions.record = normalizePermission(permission);
    return ret;
  }

  gqlPermission<
    U extends object = User,
    P extends TailorTypeGqlPermission<U> = TailorTypeGqlPermission<U>,
  >(permission: P) {
    const ret = this as TailorDBType<Fields, U>;
    ret._permissions.gql = normalizeGqlPermission(permission);
    return ret;
  }

  description(description: string) {
    this._description = description;
    return this;
  }

  /**
   * Pick specific fields from the type
   * @param keys - Array of field keys to pick
   * @param options - Optional field options to apply to picked fields
   * @returns An object containing only the specified fields
   */
  pickFields<K extends keyof Fields, const Opt extends FieldOptions>(
    keys: K[],
    options: Opt,
  ) {
    const result = {} as Record<K, TailorDBField<any, any>>;
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
   * @param keys - Array of field keys to omit
   * @returns An object containing all fields except the specified ones
   */
  omitFields<K extends keyof Fields>(keys: K[]): Omit<Fields, K> {
    const keysSet = new Set(keys);
    const result = {} as Record<string, TailorDBField<any, any>>;
    for (const key in this.fields) {
      if (
        Object.hasOwn(this.fields, key) &&
        !keysSet.has(key as unknown as K)
      ) {
        result[key] = this.fields[key];
      }
    }
    return result as Omit<Fields, K>;
  }
}

export type TailorDBInstance<
  Fields extends Record<string, TailorDBField<any, any>> = any,
  User extends object = InferredAttributeMap,
> = InstanceType<typeof TailorDBType<Fields, User>>;

const idField = uuid();
type idField = typeof idField;
type DBType<
  F extends { id?: never } & Record<string, TailorDBField<any, any>>,
> = TailorDBInstance<{ id: idField } & F>;

/**
 * Creates a new database type with the specified fields
 * @param name - The name of the type, or a tuple of [name, pluralForm]
 * @param fields - The field definitions for the type
 * @returns A new TailorDBType instance
 */
function dbType<
  const F extends { id?: never } & Record<string, TailorDBField<any, any>>,
>(name: string | [string, string], fields: F): DBType<F>;
/**
 * Creates a new database type with the specified fields and description
 * @param name - The name of the type, or a tuple of [name, pluralForm]
 * @param description - A description of the type
 * @param fields - The field definitions for the type
 * @returns A new TailorDBType instance
 */
function dbType<
  const F extends { id?: never } & Record<string, TailorDBField<any, any>>,
>(name: string | [string, string], description: string, fields: F): DBType<F>;
function dbType<
  const F extends { id?: never } & Record<string, TailorDBField<any, any>>,
>(
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
