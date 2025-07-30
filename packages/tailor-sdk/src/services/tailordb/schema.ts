/* eslint-disable @typescript-eslint/no-unused-vars */

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
  Indexes,
} from "./types";
import { TailorFieldType, TailorToTs } from "@/types/types";
import type { Prettify, output } from "@/types/helpers";
import { AllowedValues, AllowedValuesOutput } from "@/types/field";
import { ReferenceConfig, TailorField, TailorType } from "@/types/type";
import inflection from "inflection";

interface RelationConfig<T extends TailorDBType> {
  type: "oneToOne" | "1-1" | "oneToMany" | "1-n" | "1-N" | "keyOnly";
  toward: {
    type: T;
    as?: string;
    key?: keyof T["fields"] & string;
  };
  backward?: string;
}

const fieldDefaults = {
  required: undefined,
  description: undefined,
  allowedValues: undefined,
  array: undefined,
  index: undefined,
  unique: undefined,
  vector: undefined,
  foreignKey: undefined,
  foreignKeyType: undefined,
  validate: undefined,
  hooks: undefined,
  assertNonNull: undefined,
  serial: undefined,
} as const satisfies Omit<DBFieldMetadata, "type">;

class TailorDBField<
  const Defined extends DefinedFieldMetadata,
  const Output,
  const Reference extends ReferenceConfig<any> | undefined,
> extends TailorField<Defined, Output, Reference, DBFieldMetadata> {
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
    fields?: Record<string, TailorDBField<any, any, any>>,
  ) {
    super(type, fields);
    this._metadata = { type, required: true };
  }

  static create<
    const T extends TailorFieldType,
    const D extends (keyof DBFieldMetadata)[],
  >(
    type: T,
    _defines: D,
    fields?: Record<string, TailorDBField<any, any, any>>,
  ) {
    return new TailorDBField<
      Prettify<
        Pick<typeof fieldDefaults, Exclude<D[number], "name" | "type">> & {
          type: T;
        }
      >,
      TailorToTs[T],
      undefined
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
        : TailorField<CurrentDefined, Output, Reference>,
    options?: O,
  ): TailorDBField<
    Prettify<
      CurrentDefined & { required: false; assertNonNull: O["assertNonNull"] }
    >,
    Output,
    Reference
  > {
    return super.optional(options) as any;
  }

  description<const D extends string, CurrentDefined extends Defined>(
    this: CurrentDefined extends { description: unknown }
      ? never
      : TailorField<CurrentDefined, Output, Reference>,
    description: D,
  ): TailorDBField<
    Prettify<CurrentDefined & { description: D }>,
    Output,
    Reference
  > {
    return super.description(description) as any;
  }

  array<CurrentDefined extends Defined>(
    this: CurrentDefined extends { array: unknown }
      ? never
      : TailorField<CurrentDefined, Output, Reference>,
  ): TailorDBField<
    Prettify<CurrentDefined & { array: true }>,
    Output[],
    Reference
  > {
    return super.array() as any;
  }

  values<CurrentDefined extends Defined, const V extends AllowedValues>(
    this: CurrentDefined extends { allowedValues: unknown }
      ? never
      : TailorField<CurrentDefined, Output, Reference>,
    values: V,
  ): TailorDBField<
    Prettify<CurrentDefined & { allowedValues: V }>,
    AllowedValuesOutput<V>,
    Reference
  > {
    return super.values(values) as any;
  }

  relation<
    const Config extends RelationConfig<TailorDBType>,
    CurrentDefined extends Defined,
  >(
    this: Reference extends undefined
      ? TailorField<CurrentDefined, Output, Reference>
      : never,
    config: Config,
  ): TailorDBField<
    Config["type"] extends "oneToOne" | "1-1"
      ? Prettify<CurrentDefined & { unique: true; index: true }>
      : CurrentDefined,
    Output,
    Config["type"] extends "keyOnly"
      ? undefined
      : {
          nameMap: [
            Config["toward"]["as"] extends string
              ? Config["toward"]["as"]
              : Config["toward"]["type"]["name"],
            Config["backward"] extends string ? Config["backward"] : string,
          ];
          type: Config["toward"]["type"];
          key: Config["toward"]["key"] extends string
            ? Config["toward"]["key"]
            : "id";
        }
  > {
    const targetTable: TailorDBType = config.toward.type;

    if (config.type === "keyOnly") {
      const result = this as unknown as TailorDBField<
        CurrentDefined,
        Output,
        undefined
      >;
      result._metadata.foreignKeyType = targetTable.name;
      result._metadata.foreignKey = true;
      return result as any;
    }

    const forwardName =
      config.toward.as ??
      targetTable.name.charAt(0).toLowerCase() + targetTable.name.slice(1);
    const field: string = config.toward.key ?? "id";
    const backward: string = config.backward ?? "";

    const relationNames: [string, string] = [forwardName, backward];
    const result = super.ref(
      targetTable,
      relationNames,
      field,
    ) as TailorDBField<any, Output, any>;

    result._metadata.index = true;
    result._metadata.foreignKeyType = targetTable.name;
    result._metadata.foreignKey = true;

    // Store the relation type in metadata
    (result._metadata as any).relationType = config.type;

    if (["oneToOne", "1-1"].includes(config.type)) {
      result._metadata.unique = true;
    }

    return result as any;
  }

  index<CurrentDefined extends Defined>(
    this: CurrentDefined extends { index: unknown }
      ? never
      : TailorDBField<CurrentDefined, Output, Reference>,
  ) {
    this._metadata.index = true;
    return this as TailorDBField<
      Prettify<CurrentDefined & { index: true }>,
      Output,
      Reference
    >;
  }

  unique<CurrentDefined extends Defined>(
    this: CurrentDefined extends { unique: unknown }
      ? never
      : TailorDBField<CurrentDefined, Output, Reference>,
  ) {
    this._metadata.unique = true;
    this._metadata.index = true;
    return this as TailorDBField<
      Prettify<CurrentDefined & { unique: true; index: true }>,
      Output,
      Reference
    >;
  }

  vector<CurrentDefined extends Defined>(
    this: CurrentDefined extends { vector: unknown }
      ? never
      : TailorDBField<CurrentDefined, Output, Reference>,
  ) {
    this._metadata.vector = true;
    return this as TailorDBField<
      Prettify<CurrentDefined & { vector: true }>,
      Output,
      Reference
    >;
  }

  hooks<const H extends Hook<output<this>>, CurrentDefined extends Defined>(
    this: CurrentDefined extends { hooks: unknown }
      ? never
      : TailorDBField<CurrentDefined, Output, Reference>,
    hooks: H,
  ) {
    this._metadata.hooks = hooks;
    return this as unknown as TailorDBField<
      Prettify<CurrentDefined & { hooks: H }>,
      Output,
      Reference
    >;
  }

  validate<
    const V extends FieldValidateInput<Output>[],
    CurrentDefined extends Defined,
  >(
    this: CurrentDefined extends { validate: unknown }
      ? never
      : TailorDBField<CurrentDefined, Output, Reference>,
    ...validate: V
  ) {
    this._metadata.validate = validate;
    return this as unknown as TailorDBField<
      Prettify<CurrentDefined & { validate: V }>,
      Output,
      Reference
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
        ? TailorDBField<CurrentDefined, Output, Reference>
        : never,
    config: S,
  ): TailorDBField<
    Prettify<CurrentDefined & { serial: S }>,
    Output,
    Reference
  > {
    this._metadata.serial = config;
    return this as unknown as TailorDBField<
      Prettify<CurrentDefined & { serial: S }>,
      Output,
      Reference
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
  return createField("bool", ["allowedValues"]);
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

function object<const F extends Record<string, TailorDBField<any, any, any>>>(
  fields: F,
) {
  const objectField = createField(
    "nested",
    ["allowedValues"],
    fields,
  ) as TailorDBField<
    DefinedFieldMetadata & { type: "nested" },
    Prettify<
      {
        [K in keyof F as F[K]["_defined"] extends { required: false }
          ? never
          : K]: output<F[K]>;
      } & {
        [K in keyof F as F[K]["_defined"] extends { required: false }
          ? K
          : never]?: output<F[K]> | null;
      }
    >,
    undefined
  >;
  return objectField;
}

export class TailorDBType<
  const F extends { id?: never } & Record<
    string,
    TailorDBField<M, any, any>
  > = any,
  M extends DefinedFieldMetadata = any,
> extends TailorType<
  M,
  F & Record<string, TailorField<M, any, any, DBFieldMetadata>>
> {
  private _metadata?: TailorDBTypeConfig;
  public readonly referenced: Record<string, [TailorDBType, string]> = {};
  private _description: string | undefined;
  private _settings: { pluralForm?: string } = {};
  private _indexes: Indexes<this>[] = [];

  constructor(
    public readonly name: string,
    public readonly fields: F,
    options: { pluralForm?: string; description?: string },
  ) {
    super(
      fields as F & Record<string, TailorField<M, any, any, DBFieldMetadata>>,
    );
    this._settings.pluralForm = options.pluralForm;
    this._description = options.description;

    Object.entries(this.fields).forEach(([fieldName, field]) => {
      if (field.reference && field.reference !== undefined) {
        const ref = field.reference;
        if (ref.type) {
          let backwardFieldName = ref.nameMap?.[1]; // Get backward field name from nameMap

          if (!backwardFieldName || backwardFieldName === "") {
            const metadata = field.metadata;
            const relationType = metadata?.unique ? "1-1" : "1-n";

            if (relationType === "1-1") {
              backwardFieldName = inflection.singularize(
                this.name.charAt(0).toLowerCase() + this.name.slice(1),
              );
            } else {
              backwardFieldName = inflection.pluralize(
                this.name.charAt(0).toLowerCase() + this.name.slice(1),
              );
            }
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

    this._metadata = {
      name: this.name,
      schema: {
        description: this._description,
        extends: false,
        fields: metadataFields,
        settings: this._settings,
        ...(Object.keys(indexes).length > 0 && { indexes }),
      },
    };

    return this._metadata;
  }

  hooks(hooks: Hooks<typeof this>) {
    Object.entries(hooks).forEach(([fieldName, fieldHooks]: [string, any]) => {
      (this.fields[fieldName] as any).hooks(fieldHooks);
    });
    return this;
  }

  validate(validators: Validators<typeof this>) {
    Object.entries(validators).forEach(([fieldName, fieldValidators]) => {
      const field = this.fields[fieldName] as TailorDBField<any, any, any>;

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

  features(features: { aggregation?: true; bulkUpsert?: true }) {
    this._settings = { ...this._settings, ...features };
    return this;
  }

  indexes(...indexes: Indexes<this>[]) {
    this._indexes = indexes;
    return this;
  }
}

const idField = uuid();
type idField = typeof idField;
type DBType<
  F extends { id?: never } & Record<string, TailorDBField<any, any, any>>,
> = TailorDBType<{ id: idField } & F, DefinedFieldMetadata>;

/**
 * Creates a new database type with the specified fields
 * @param name - The name of the type, or a tuple of [name, pluralForm]
 * @param fields - The field definitions for the type
 * @returns A new TailorDBType instance
 */
function dbType<
  const F extends { id?: never } & Record<string, TailorDBField<any, any, any>>,
>(name: string | [string, string], fields: F): DBType<F>;
/**
 * Creates a new database type with the specified fields and description
 * @param name - The name of the type, or a tuple of [name, pluralForm]
 * @param description - A description of the type
 * @param fields - The field definitions for the type
 * @returns A new TailorDBType instance
 */
function dbType<
  const F extends { id?: never } & Record<string, TailorDBField<any, any, any>>,
>(name: string | [string, string], description: string, fields: F): DBType<F>;
function dbType<
  const F extends { id?: never } & Record<string, TailorDBField<any, any, any>>,
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
        .hooks({
          create: () => new Date().toISOString(),
        }),
      updatedAt: datetime()
        .optional()
        .hooks({
          update: () => new Date().toISOString(),
        }),
    }),
  },
};

export default db;
export { _enum as enum, db, dbType as type };
