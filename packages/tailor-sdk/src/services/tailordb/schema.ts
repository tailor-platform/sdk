import { clone } from "es-toolkit";

import { OperatorFieldConfig } from "@/types/operator";
import { TailorDBTypeConfig } from "./operator-types";
import {
  DBFieldMetadata,
  Hooks,
  Validators,
  DefinedFieldMetadata,
  FieldValidateInput,
  Hook,
  ValidateConfig,
  SerialConfig,
  IndexDef,
  TypeFeatures,
} from "./types";
import {
  InferFieldInput,
  InferFieldOutput,
  NullableToOptional,
  TailorFieldType,
  TailorToTs,
} from "@/types/types";
import type { Prettify, output } from "@/types/helpers";
import { AllowedValues, AllowedValuesOutput } from "@/types/field";
import { TailorField, TailorType } from "@/types/type";
import inflection from "inflection";
import {
  Permissions,
  TailorTypeGqlPermission,
  TailorTypePermission,
  normalizePermission,
  normalizeGqlPermission,
} from "./permission";

interface RelationConfig<T extends TailorDBType> {
  type: "oneToOne" | "1-1" | "manyToOne" | "n-1" | "N-1" | "keyOnly";
  toward: {
    type: T;
    as?: string;
    key?: keyof T["fields"] & string;
  };
  backward?: string;
}

// Special config variant for self-referencing relations
type RelationSelfConfig = {
  type: "oneToOne" | "1-1" | "manyToOne" | "n-1" | "N-1" | "keyOnly";
  toward: {
    type: "self";
    as?: string;
    key?: string;
  };
  backward?: string;
};

interface ReferenceConfig<T extends TailorDBType> {
  type: TailorDBType;
  key: keyof T["fields"] & string;
  nameMap: [string, string];
}

interface fieldDefaults extends Omit<DBFieldMetadata, "type"> {
  required: undefined;
  description: undefined;
  allowedValues: undefined;
  array: undefined;
  index: undefined;
  unique: undefined;
  vector: undefined;
  foreignKey: undefined;
  foreignKeyType: undefined;
  validate: undefined;
  hooks: undefined;
  assertNonNull: undefined;
  serial: undefined;
}

class TailorDBField<
  const Defined extends DefinedFieldMetadata,
  const Output,
> extends TailorField<Defined, Output, DBFieldMetadata> {
  private _ref: ReferenceConfig<TailorDBType> | undefined = undefined;

  get reference(): Readonly<ReferenceConfig<TailorDBType>> | undefined {
    return clone(this._ref);
  }

  get metadata() {
    return { ...this._metadata };
  }

  get config(): OperatorFieldConfig {
    return {
      ...this._metadata,
      validate: this._metadata.validate?.map((v) => {
        const { fn, message } =
          typeof v === "function"
            ? { fn: v, message: `failed by \`${v.toString().trim()}\`` }
            : { fn: v[0], message: v[1] };

        return {
          script: {
            expr: `(${fn.toString().trim()})({ value: _value, user })`,
          },
          errorMessage: message,
        };
      }),
      hooks: this._metadata.hooks
        ? {
            create: this._metadata.hooks.create
              ? {
                  expr: `(${this._metadata.hooks.create
                    .toString()
                    .trim()})({ value: _value, data: _data, user })`,
                }
              : undefined,
            update: this._metadata.hooks.update
              ? {
                  expr: `(${this._metadata.hooks.update
                    .toString()
                    .trim()})({ value: _value, data: _data, user })`,
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
    fields?: Record<string, TailorDBField<any, any>>,
  ) {
    super(type, fields);
    this._metadata = { type, required: true };
  }

  static create<
    const T extends TailorFieldType,
    const D extends (keyof DBFieldMetadata)[],
  >(type: T, _defines: D, fields?: Record<string, TailorDBField<any, any>>) {
    return new TailorDBField<
      Prettify<
        Pick<fieldDefaults, Exclude<D[number], "name" | "type">> & {
          type: T;
        }
      >,
      TailorToTs[T]
    >(type, fields);
  }

  optional<
    CurrentDefined extends Defined,
    const O extends { assertNonNull?: boolean } = { assertNonNull: false },
  >(
    this: CurrentDefined extends { required: unknown }
      ? never
      : CurrentDefined extends { assertNonNull: unknown }
        ? never
        : TailorField<CurrentDefined, Output>,
    options?: O,
  ): TailorDBField<
    Prettify<
      CurrentDefined & { required: false; assertNonNull: O["assertNonNull"] }
    >,
    Output
  > {
    return super.optional(options) as any;
  }

  description<const D extends string, CurrentDefined extends Defined>(
    this: CurrentDefined extends { description: unknown }
      ? never
      : TailorField<CurrentDefined, Output>,
    description: D,
  ): TailorDBField<Prettify<CurrentDefined & { description: D }>, Output> {
    return super.description(description) as any;
  }

  array<CurrentDefined extends Defined>(
    this: CurrentDefined extends { array: unknown }
      ? never
      : TailorField<CurrentDefined, Output>,
  ): TailorDBField<Prettify<CurrentDefined & { array: true }>, Output[]> {
    return super.array() as any;
  }

  values<CurrentDefined extends Defined, const V extends AllowedValues>(
    this: CurrentDefined extends { allowedValues: unknown }
      ? never
      : TailorField<CurrentDefined, Output>,
    values: V,
  ): TailorDBField<
    Prettify<CurrentDefined & { allowedValues: V }>,
    AllowedValuesOutput<V>
  > {
    return super.values(values) as any;
  }

  relation<
    const Config extends RelationConfig<TailorDBType>,
    CurrentDefined extends Defined,
  >(
    this: CurrentDefined extends { relation: unknown }
      ? never
      : TailorDBField<CurrentDefined, Output>,
    config: Config,
  ): TailorDBField<
    Config["type"] extends "oneToOne" | "1-1"
      ? Prettify<CurrentDefined & { unique: true; index: true; relation: true }>
      : Prettify<CurrentDefined & { index: true; relation: true }>,
    Output
  >;

  // Overload: self-referencing variant
  relation<
    const Config extends RelationSelfConfig,
    CurrentDefined extends Defined,
  >(
    this: CurrentDefined extends { relation: unknown }
      ? never
      : TailorDBField<CurrentDefined, Output>,
    config: Config,
  ): TailorDBField<
    Config["type"] extends "oneToOne" | "1-1"
      ? Prettify<CurrentDefined & { unique: true; index: true; relation: true }>
      : Prettify<CurrentDefined & { index: true; relation: true }>,
    Output
  >;

  // Implementation
  relation<
    const Config extends RelationConfig<TailorDBType> | RelationSelfConfig,
    CurrentDefined extends Defined,
  >(
    this: CurrentDefined extends { relation: unknown }
      ? never
      : TailorDBField<CurrentDefined, Output>,
    config: Config,
  ): any {
    const result = this as unknown as TailorDBField<any, Output>;
    // Allow special self-referencing config as well (handled at runtime in TailorDBType)
    const isSelf = (config as any)?.toward?.type === "self";

    result._metadata.index = true;
    result._metadata.foreignKey = true;
    result._metadata.unique = ["oneToOne", "1-1"].includes(config.type);

    // Set foreignKeyType for non-self relation as early as possible
    if (!isSelf) {
      const targetTable: TailorDBType = (
        config as RelationConfig<TailorDBType>
      )["toward"].type;
      result._metadata.foreignKeyType = targetTable.name;
    }

    if ((config as any).type === "keyOnly") {
      return result as any;
    }

    const key: string = (config as any)?.toward?.key ?? "id";
    const backward: string = (config as any)?.backward ?? "";

    if (isSelf) {
      const selfConfig = config as RelationSelfConfig;
      // Defer resolving the self reference until the type is constructed
      (result as any)._pendingSelfRelation = {
        as: selfConfig.toward.as,
        key,
        backward,
        relationType: selfConfig.type,
      } as const;
      result._metadata.relation = true;
      return result as any;
    }

    const typeConfig = config as RelationConfig<TailorDBType>;
    const targetTable: TailorDBType = typeConfig.toward.type;

    const forwardName =
      typeConfig.toward.as ?? inflection.camelize(targetTable.name, true);

    this._ref = {
      type: targetTable,
      nameMap: [forwardName, backward],
      key,
    };

    result._metadata.relation = true;
    return result as any;
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
      : TailorDBField<CurrentDefined, Output>,
  ) {
    this._metadata.vector = true;
    return this as TailorDBField<
      Prettify<CurrentDefined & { vector: true }>,
      Output
    >;
  }

  hooks<
    const H extends Hook<
      InferFieldInput<this>,
      unknown,
      InferFieldOutput<this>
    >,
    CurrentDefined extends Defined,
  >(
    this: CurrentDefined extends { hooks: unknown }
      ? never
      : TailorDBField<CurrentDefined, Output>,
    hooks: H,
  ) {
    this._metadata.hooks = hooks;
    return this as unknown as TailorDBField<
      Prettify<CurrentDefined & { hooks: H }>,
      Output
    >;
  }

  validate<
    const V extends FieldValidateInput<Output>[],
    CurrentDefined extends Defined,
  >(
    this: CurrentDefined extends { validate: unknown }
      ? never
      : TailorDBField<CurrentDefined, Output>,
    ...validate: V
  ) {
    this._metadata.validate = validate;
    return this as unknown as TailorDBField<
      Prettify<CurrentDefined & { validate: V }>,
      Output
    >;
  }

  serial<
    T extends CurrentDefined["type"] extends "integer" | "string"
      ? CurrentDefined["type"]
      : never,
    const S extends SerialConfig<T>,
    CurrentDefined extends Defined,
  >(
    this: CurrentDefined extends { serial: unknown }
      ? never
      : CurrentDefined extends { type: "integer" | "string" }
        ? TailorDBField<CurrentDefined, Output>
        : never,
    config: S,
  ): TailorDBField<Prettify<CurrentDefined & { serial: S }>, Output> {
    this._metadata.serial = config;
    return this as unknown as TailorDBField<
      Prettify<CurrentDefined & { serial: S }>,
      Output
    >;
  }
}

const createField = TailorDBField.create;
function uuid() {
  return createField("uuid", ["allowedValues"]);
}

function string() {
  return createField("string", ["allowedValues"]);
}

function bool() {
  return createField("boolean", ["allowedValues"]);
}

function int() {
  return createField("integer", ["allowedValues"]);
}

function float() {
  return createField("float", ["allowedValues"]);
}

function date() {
  return createField("date", ["allowedValues"]);
}

function datetime() {
  return createField("datetime", ["allowedValues"]);
}

function time() {
  return createField("time", ["allowedValues"]);
}

function _enum<const V extends AllowedValues>(...values: V) {
  return createField("enum", []).values(values);
}

function object<const F extends Record<string, TailorDBField<any, any>>>(
  fields: F,
) {
  const objectField = createField(
    "nested",
    ["allowedValues"],
    fields,
  ) as TailorDBField<
    DefinedFieldMetadata & { type: "nested" },
    Prettify<
      NullableToOptional<{
        [K in keyof F]: InferFieldOutput<F[K]>;
      }>
    >
  >;
  return objectField;
}

export class TailorDBType<
  const Fields extends { id?: never } & Record<
    string,
    TailorDBField<Metadata, any>
  > = any,
  Metadata extends DefinedFieldMetadata = any,
  User extends object = never,
> extends TailorType<
  Metadata,
  Fields & Record<string, TailorField<Metadata, any, DBFieldMetadata>>
> {
  public readonly referenced: Record<string, [TailorDBType, string]> = {};
  private _description: string | undefined;
  private _settings: TypeFeatures = {};
  private _indexes: IndexDef<this>[] = [];
  private _permissions: Permissions = {};
  private _files: Record<string, string> = {};

  constructor(
    public readonly name: string,
    public readonly fields: Fields,
    options: { pluralForm?: string; description?: string },
  ) {
    super(
      fields as Fields &
        Record<string, TailorField<Metadata, any, DBFieldMetadata>>,
    );

    this._description = options.description;

    const pluralForm = options.pluralForm || inflection.pluralize(name);
    if (name === pluralForm) {
      throw new Error(
        `The name and the plural form must be different. name=${name}`,
      );
    }
    this._settings.pluralForm = pluralForm;

    // Resolve any pending self-references now that the type is constructed
    Object.entries(this.fields).forEach(([fieldName, field]) => {
      const pending = (field as any)._pendingSelfRelation as
        | { as?: string; key: string; backward: string; relationType?: string }
        | undefined;
      if (pending) {
        const forwardName = pending.as ?? fieldName.replace(/(ID|Id|id)$/u, "");
        // Type conversion for manipulating private _ref.
        (field as unknown as { _ref: ReferenceConfig<TailorDBType> })._ref = {
          type: this,
          nameMap: [forwardName, pending.backward],
          key: pending.key,
        };
        (field as any)._metadata.foreignKeyType = this.name;
      }
    });

    Object.entries(this.fields).forEach(([fieldName, field]) => {
      if (field.reference && field.reference !== undefined) {
        const ref = field.reference;
        if (ref.type) {
          let backwardFieldName = ref.nameMap?.[1]; // Get backward field name from nameMap

          if (!backwardFieldName || backwardFieldName === "") {
            const lowerName = inflection.camelize(this.name, true);
            backwardFieldName = field.metadata?.unique
              ? inflection.singularize(lowerName)
              : inflection.pluralize(lowerName);
          }

          ref.type.referenced[backwardFieldName] = [this, fieldName];
        }
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

  hooks(hooks: Hooks<typeof this>) {
    Object.entries(hooks).forEach(([fieldName, fieldHooks]: [string, any]) => {
      (this.fields[fieldName] as any).hooks(fieldHooks);
    });
    return this;
  }

  validate(validators: Validators<typeof this>) {
    Object.entries(validators).forEach(([fieldName, fieldValidators]) => {
      const field = this.fields[fieldName] as TailorDBField<any, any>;

      const validators = fieldValidators as
        | ValidateConfig<any>
        | FieldValidateInput<any>[];
      if (validators.length === 2 && typeof validators[1] === "string") {
        field.validate(validators as ValidateConfig<any>);
      } else {
        field.validate(...(validators as FieldValidateInput<any>[]));
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
    const ret = this as unknown as TailorDBType<Fields, Metadata, U>;
    ret._permissions.record = normalizePermission(permission);
    return ret;
  }

  gqlPermission<
    U extends object = User,
    P extends TailorTypeGqlPermission<U> = TailorTypeGqlPermission<U>,
  >(permission: P) {
    const ret = this as unknown as TailorDBType<Fields, Metadata, U>;
    ret._permissions.gql = normalizeGqlPermission(permission);
    return ret;
  }
}

const idField = uuid();
type idField = typeof idField;
type DBType<
  F extends { id?: never } & Record<string, TailorDBField<any, any>>,
> = TailorDBType<{ id: idField } & F, DefinedFieldMetadata>;

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
    fieldDef = fieldsOrDescription as F;
  }
  const type = new TailorDBType<{ id: idField } & F, DefinedFieldMetadata>(
    typeName,
    {
      id: idField,
      ...fieldDef,
    },
    { pluralForm, description },
  ) as DBType<F>;
  return type;
}

const db = {
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
        .optional({ assertNonNull: true })
        .hooks({ create: () => new Date().toISOString() }),
      updatedAt: datetime()
        .optional()
        .hooks({ update: () => new Date().toISOString() }),
    }),
  },
};

export default db;
export { _enum as enum, db, dbType as type };
