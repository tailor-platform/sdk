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
  DefinedFieldMetadata,
  FieldValidateFn,
  Hook,
} from "./types";
import { TailorFieldType, TailorToTs } from "@/types/types";
import type { Prettify, output, DeepWriteable } from "@/types/helpers";
import {
  AllowedValues,
  AllowedValuesOutput,
  mapAllowedValues,
} from "@/types/field";
import { clone } from "es-toolkit";

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
} as const satisfies Omit<DBFieldMetadata, "type">;

export type FieldReference<T extends TailorDBField> = DeepWriteable<
  NonNullable<T["reference"]>
>;

export type ReferenceConfig<
  T extends TailorDBType = TailorDBType,
  M extends [string, string] = [string, string],
> = {
  nameMap: M;
  type: T;
  field?: keyof T["fields"];
};

class TailorDBField<
  const Defined extends DefinedFieldMetadata = DefinedFieldMetadata,
  const Output = any,
  const Reference extends ReferenceConfig | undefined = any,
> {
  public readonly type: TailorFieldType;
  public readonly _defined: Defined = undefined as unknown as Defined;
  public readonly _output = undefined as Output;
  protected _metadata: DBFieldMetadata;

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
                  expr: `(${this._metadata.hooks.create.toString().trim()})({ value: _value, data: _data, user })`,
                })
              : undefined,
            update: this._metadata.hooks.update
              ? new Script({
                  expr: `(${this._metadata.hooks.update.toString().trim()})({ value: _value, data: _data, user })`,
                })
              : undefined,
          })
        : undefined,
      allowedValues: this._metadata.allowedValues || [],
    });
  }

  setHooks(hooks: Hook<Output, any>) {
    this._metadata.hooks = hooks;
  }

  private constructor(type: TailorFieldType) {
    this.type = type;
    this._metadata = { ...fieldDefaults, type, required: true };
  }

  static create<
    const T extends TailorFieldType,
    const D extends (keyof DBFieldMetadata)[],
  >(type: T, _defines: D) {
    return new TailorDBField<
      Prettify<
        Pick<typeof fieldDefaults, Exclude<D[number], "name" | "type">> & {
          type: T;
        }
      >,
      TailorToTs[T],
      undefined
    >(type);
  }

  optional<CurrentDefined extends Defined>(
    this: CurrentDefined extends { required: unknown }
      ? never
      : TailorDBField<CurrentDefined, Output, Reference>,
  ): TailorDBField<
    Prettify<CurrentDefined & { required: false }>,
    Output | null,
    Reference
  > {
    this._metadata.required = false;
    return this as any;
  }

  description<const D extends string, CurrentDefined extends Defined>(
    this: CurrentDefined extends { description: unknown }
      ? never
      : TailorDBField<CurrentDefined, Output, Reference>,
    description: D,
  ): TailorDBField<
    Prettify<CurrentDefined & { description: D }>,
    Output,
    Reference
  > {
    this._metadata.description = description;
    return this as any;
  }

  array<CurrentDefined extends Defined>(
    this: CurrentDefined extends { array: unknown }
      ? never
      : TailorDBField<CurrentDefined, Output, Reference>,
  ): TailorDBField<
    Prettify<CurrentDefined & { array: true }>,
    Output[],
    Reference
  > {
    this._metadata.array = true;
    return this as any;
  }

  values<CurrentDefined extends Defined, const V extends AllowedValues>(
    this: CurrentDefined extends { allowedValues: unknown }
      ? never
      : TailorDBField<CurrentDefined, Output, Reference>,
    values: V,
  ): TailorDBField<
    Prettify<CurrentDefined & { allowedValues: V }>,
    AllowedValuesOutput<V>,
    Reference
  > {
    this._metadata.allowedValues = mapAllowedValues(values);
    return this as any;
  }

  private _ref: Reference = undefined as Reference;
  get reference(): Readonly<Reference> | null {
    return clone(this._ref);
  }
  ref<
    const M extends [string, string],
    const T extends TailorDBType,
    const F extends keyof T["fields"] & string,
    CurrentDefined extends Defined,
  >(
    this: Reference extends undefined
      ? TailorDBField<CurrentDefined, Output, Reference>
      : never,
    type: T,
    nameMap: M,
    field: F = "id" as F,
  ): TailorDBField<CurrentDefined, Output, { nameMap: M; type: T; field: F }> {
    (this as any)._ref = {
      nameMap,
      type,
      field,
    };
    this._metadata.index = true;
    this._metadata.foreignKeyType = type.name;
    this._metadata.foreignKey = true;
    return this as unknown as TailorDBField<
      CurrentDefined,
      Output,
      { nameMap: M; type: T; field: F }
    >;
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

type DBTypeOptions = {
  withTimestamps?: boolean;
  description?: string;
};

export class TailorDBType<
  const F extends { id?: never } & Record<string, TailorDBField<M>> = any,
  M extends DefinedFieldMetadata = DefinedFieldMetadata,
> {
  private _metadata?: TDB;
  public referenced: TailorDBType[] = [];
  public readonly _output = null as unknown as any;

  constructor(
    public readonly name: string,
    public readonly fields: F,
    public readonly options: DBTypeOptions = {},
  ) {
    if (this.options.withTimestamps) {
      this.fields = { ...this.fields, ...datetimeFields };
    }

    // RelationShips定義用に参照先にthisを設定しておく
    Object.entries(this.fields).forEach(([_, field]) => {
      if (field.reference) {
        const ref = field.reference;
        ref.type.referenced.push(this);
      }
    });
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
        description: this.options.description,
        extends: false,
        fields: metadataFields,
      },
    });

    return this._metadata;
  }

  hooks(hooks: Hooks<output<typeof this>>) {
    Object.entries(hooks).forEach(([fieldName, fieldHooks]: [string, any]) => {
      this.fields[fieldName].setHooks(fieldHooks);
    });
    return this;
  }
}

type TailorDBDef = InstanceType<
  typeof TailorDBType<
    Record<string, TailorDBField<DefinedFieldMetadata, any, any>>,
    DefinedFieldMetadata
  >
>;

const idField = uuid();
type idField = typeof idField;
const datetimeFields = {
  createdAt: (() => {
    const field = datetime().optional();
    field.setHooks({
      create: () => new Date().toISOString(),
    });
    return field;
  })(),
  updatedAt: (() => {
    const field = datetime().optional();
    field.setHooks({
      update: () => new Date().toISOString(),
    });
    return field;
  })(),
} as const satisfies Record<string, TailorDBField<any, any, any>>;
type DBType<
  F extends { id?: never } & Record<string, TailorDBField<any, any, any>>,
  O extends DBTypeOptions = object,
> = O extends { withTimestamps: true }
  ? TailorDBType<
      { id: idField } & F & typeof datetimeFields,
      DefinedFieldMetadata
    >
  : TailorDBType<{ id: idField } & F, DefinedFieldMetadata>;

function dbType<
  const F extends { id?: never } & Record<string, TailorDBField<any, any, any>>,
  const O extends DBTypeOptions,
>(name: string, fields: F, options?: O): DBType<F, O> {
  if (options?.withTimestamps) {
    return new TailorDBType<
      { id: idField } & F & typeof datetimeFields,
      DefinedFieldMetadata
    >(
      name,
      {
        id: idField,
        ...fields,
        ...datetimeFields,
      },
      options,
    );
  }
  return new TailorDBType<{ id: idField } & F, DefinedFieldMetadata>(
    name,
    { id: idField, ...fields },
    options,
  ) as DBType<F, O>;
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
  string,
  TailorDBDef,
  uuid,
};
