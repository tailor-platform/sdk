/* eslint-disable @typescript-eslint/no-unused-vars */

import {
  Script,
  TailorDBType as TDB,
  TailorDBType_FieldConfig,
  TailorDBType_FieldHook,
  TailorDBType_ValidateConfig,
} from "@tailor-inc/operator-client";
import {
  DBFieldMetadata,
  Hooks,
  Validators,
  DefinedFieldMetadata,
  FieldValidateFn,
  Hook,
} from "./types";
import { TailorFieldType, TailorToTs } from "@/types/types";
import type { Prettify, output } from "@/types/helpers";
import { AllowedValues, AllowedValuesOutput } from "@/types/field";
import { ReferenceConfig, TailorField, TailorType } from "@/types/type";

interface RelationConfig<T extends TailorDBType> {
  type: "oneToOne" | "1-1" | "oneToMany" | "1-n" | "1-N";
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
} as const satisfies Omit<DBFieldMetadata, "type">;

class TailorDBField<
  const Defined extends DefinedFieldMetadata,
  const Output,
  const Reference extends ReferenceConfig<any> | undefined,
> extends TailorField<Defined, Output, Reference, DBFieldMetadata> {
  get metadata() {
    return { ...this._metadata };
  }

  get config() {
    return new TailorDBType_FieldConfig({
      ...this._metadata,
      validate: this._metadata.validate?.map((v) => {
        return new TailorDBType_ValidateConfig({
          script: new Script({
            expr: `(${v.toString().trim()})({ value: _value, user })`,
          }),
        });
      }),
      hooks: this._metadata.hooks
        ? new TailorDBType_FieldHook({
            create: this._metadata.hooks.create
              ? new Script({
                  expr: `(${this._metadata.hooks.create
                    .toString()
                    .trim()})({ value: _value, data: _data, user })`,
                })
              : undefined,
            update: this._metadata.hooks.update
              ? new Script({
                  expr: `(${this._metadata.hooks.update
                    .toString()
                    .trim()})({ value: _value, data: _data, user })`,
                })
              : undefined,
          })
        : undefined,
    });
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
    {
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
    const V extends FieldValidateFn<Output>[],
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
  private _metadata?: TDB;
  public referenced: TailorDBType[] = [];
  private _description: string | undefined;

  constructor(
    public readonly name: string,
    public readonly fields: F,
  ) {
    super(
      fields as F & Record<string, TailorField<M, any, any, DBFieldMetadata>>,
    );

    Object.entries(this.fields).forEach(([_, field]) => {
      if (field.reference) {
        const ref = field.reference;
        ref.type.referenced.push(this);
      }
    });
  }

  set description(description: string) {
    this._description = description;
  }

  get metadata(): TDB {
    const metadataFields = Object.entries(this.fields).reduce(
      (acc, [key, field]) => {
        acc[key] = field.config;
        return acc;
      },
      {} as Record<string, TailorDBType_FieldConfig>,
    );

    this._metadata = new TDB({
      name: this.name,
      schema: {
        description: this._description,
        extends: false,
        fields: metadataFields,
      },
    });

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
      const field = this.fields[fieldName];
      (field as any).validate(...(fieldValidators as unknown[]));
    });
    return this;
  }
}

const idField = uuid();
type idField = typeof idField;
type DBType<
  F extends { id?: never } & Record<string, TailorDBField<any, any, any>>,
> = TailorDBType<{ id: idField } & F, DefinedFieldMetadata>;

function dbType<
  const F extends { id?: never } & Record<string, TailorDBField<any, any, any>>,
>(name: string, fields: F): DBType<F> {
  return new TailorDBType<{ id: idField } & F, DefinedFieldMetadata>(name, {
    id: idField,
    ...fields,
  }) as DBType<F>;
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
export {
  _enum as enum,
  bool,
  date,
  datetime,
  db,
  dbType as type,
  float,
  int,
  object,
  string,
  uuid,
};
