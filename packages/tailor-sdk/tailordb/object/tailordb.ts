import {
  TailorDBType as TDB,
  Script,
  TailorDBType_FieldConfig,
  TailorDBType_FieldHook,
  TailorDBType_ValidateConfig,
  TailorDBType_Value,
} from "@tailor-inc/operator-client";
import {
  AllowedValue,
  TailorDB2TS,
  TailorDBFieldMetadata,
  TailorDBFieldType,
} from "./types";
import { tailor2gql } from "./constants";
import { FieldMetadata, TypeMetadata } from "../../schema-generator";

type Prettify<T> = {
  -readonly [K in keyof T]: T[K];
} & {};
type DeepWriteable<T> = T extends {}
  ? { -readonly [P in keyof T]: DeepWriteable<T[P]> } & {}
  : T;
type _output<T> = T extends { _output: infer U } ? DeepWriteable<U> : never;

type AllowedValueAlias = string | [string] | [string, string];
type AllowedValues =
  | [AllowedValueAlias, ...AllowedValueAlias[]]
  | [AllowedValue, ...AllowedValue[]];
type EnumValues<V extends AllowedValues> = V[number] extends string
  ? V[number]
  : V[number] extends [infer K, ...any]
  ? K
  : V[number] extends { value: infer K }
  ? K
  : never;

type User = {
  id: string;
  attributes: Record<string, any>;
};
type ValidateFn<O, P = undefined> = (
  args: P extends undefined
    ? { value: O; user: User }
    : { value: O; data: P; user: User },
) => boolean;
type FieldValidateFn<O> = ValidateFn<O>;
type FieldValidator<O> =
  | FieldValidateFn<O>
  | {
    script: FieldValidateFn<O>;
    action?: "allow" | "deny";
    error_message?: string;
  };
type TypeValidateFn<P, O> = (args: {
  value: O;
  data: P;
  user: User;
}) => boolean;

type ReferenceConfig<T extends InstanceType<typeof TailorDBType> = InstanceType<typeof TailorDBType>, M extends [string, string] = [string, string]> = {
  nameMap: M,
  type: T,
  field?: keyof T["fields"];
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
  validate: undefined,
  hooks: undefined,
} as const satisfies Omit<TailorDBFieldMetadata, "type">;

class TailorDBField<
  const Defined extends Partial<TailorDBFieldMetadata>,
  const Output,
  const Reference extends ReferenceConfig | undefined,
> {
  protected _metadata: TailorDBFieldMetadata;
  public readonly _defined: Defined = undefined as unknown as Defined;
  public readonly _output = undefined as Output;
  private _ref: Reference = undefined as Reference;

  get metadata() {
    return structuredClone(this._metadata);
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
              expr: this._metadata.hooks.create.toString().trim(),
            })
            : undefined,
          update: this._metadata.hooks.update
            ? new Script({
              expr: this._metadata.hooks.update.toString().trim(),
            })
            : undefined,
        }) : undefined,
    });
  }

  get reference(): Readonly<Reference> | null {
    return this._ref ? structuredClone(this._ref) : null;
  }

  private constructor(type: TailorDBFieldType) {
    this._metadata = { type, required: true };
  }

  static create<
    const T extends TailorDBFieldType,
    const D extends (keyof TailorDBFieldMetadata)[],
  >(type: T, _defines: D) {
    return new TailorDBField<
      Prettify<Pick<typeof fieldDefaults, Exclude<D[number], "name" | "type">> & { type: T }>,
      TailorDB2TS[T],
      undefined
    >(type);
  }

  optional<CurrentDefined extends Defined>(
    this: CurrentDefined extends { required: unknown }
      ? never
      : TailorDBField<CurrentDefined, Output, Reference>,
  ) {
    this._metadata.required = false;
    return this as TailorDBField<
    Prettify<CurrentDefined & { required: false }>,
    Output,
    Reference
  >;
  }

  description<const D extends string, CurrentDefined extends Defined>(
    this: CurrentDefined extends { description: unknown }
      ? never
      : TailorDBField<CurrentDefined, Output, Reference>,
    description: D,
  ) {
    this._metadata.description = description;
    return this as unknown as TailorDBField<
    Prettify<CurrentDefined & { description: D }>,
    Output,
    Reference
  >;
  }

  array<CurrentDefined extends Defined>(
    this: CurrentDefined extends { array: unknown }
      ? never
      : TailorDBField<CurrentDefined, Output, Reference>,
  ) {
    this._metadata.array = true;
    return this as TailorDBField<Prettify<CurrentDefined & { array: true }>, Output, Reference>;
  }

  index<CurrentDefined extends Defined>(
    this: CurrentDefined extends { index: unknown }
      ? never
      : TailorDBField<CurrentDefined, Output, Reference>,
  ) {
    this._metadata.index = true;
    return this as TailorDBField<Prettify<CurrentDefined & { index: true }>, Output, Reference>;
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
    return this as TailorDBField<Prettify<CurrentDefined & { vector: true }>, Output, Reference>;
  }

  values<CurrentDefined extends Defined, const V extends AllowedValues>(
    this: CurrentDefined extends { allowedValues: unknown }
      ? never
      : TailorDBField<CurrentDefined, Output, Reference>,
    values: V,
  ) {
    this._metadata.allowedValues = values
      .map((value) =>
        typeof value === "string"
          ? { value }
          : Array.isArray(value)
            ? { value: value[0], description: value[1] }
            : value,
      )
      .map((v) => new TailorDBType_Value(v));
    return this as unknown as TailorDBField<
      Prettify<CurrentDefined & { allowedValues: V }>,
      EnumValues<V>,
      Reference
    >;
  }

  validate<const V extends FieldValidateFn<Output>[], CurrentDefined extends Defined>(
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

  hooks<
    const H extends {
      create?: Function;
      update?: Function;
    },
    CurrentDefined extends Defined
  >(
    this: CurrentDefined extends { hooks: unknown }
      ? never
      : TailorDBField<CurrentDefined, Output, Reference>,
    hooks: H,
  ) {
    this._metadata.hooks = hooks;
    return this as unknown as TailorDBField<Prettify<CurrentDefined & { hooks: H }>, Output, Reference>;
  }

  ref<
    const M extends [string, string],
    const T extends InstanceType<typeof TailorDBType<any>>,
    const F extends keyof T["fields"] & string,
    CurrentDefined extends Defined
  >(
    this: Reference extends undefined
      ? TailorDBField<CurrentDefined, Output, Reference>
      : never,
    type: T,
    nameMap: M,
    field: F = "id" as F,
  ) {
    (this as any)._ref = {
      nameMap,
      type,
      field,
    };
    return this as unknown as TailorDBField<
      CurrentDefined,
      Output,
      { nameMap: M, type: T, field: F }
    >;
  }

  toSDLMetadata(): (Omit<FieldMetadata, "name"> & { name?: string })[] {
    return [
      {
        type: tailor2gql[this._metadata.type],
        elementType: tailor2gql[this._metadata.type],
        isNullable: !this._metadata.required,
        isList: !!this._metadata.array,
      },
      ...(this._ref ? [{
        name: this._ref.nameMap[0],
        type: this._ref.type.name,
        elementType: this._ref.type.name,
        isNullable: !this._metadata.required,
        isList: !!this._metadata.array,
      }] : []),
    ];
  }
}

const createField = TailorDBField.create;
function  uuid() {
  return createField("uuid", ["allowedValues"])
};

function string() {
  return createField("string", ["allowedValues"]);
};


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

function _enum<const V extends AllowedValues>(values: V) {
  return createField("enum", []).values(values);
}

type TailorDBFieldReference<T extends TailorDBField<any, any, any>> = DeepWriteable<NonNullable<T["reference"]>>;

type DBTypeOptions = {
  withTimestamps?: boolean;
  description?: string;
};

class TailorDBType<
  const F extends { id?: never } & Record<
    string,
    TailorDBField<
      Partial<TailorDBFieldMetadata>,
      any,
      any
    >
  >,
> {
  public readonly metadata: TDB;
  public readonly _output = null as unknown as Prettify<
    {
      [K in keyof F as F[K]["_defined"] extends { required: false }
      ? never
      : K]: _output<F[K]>;
    } & {
      [K in keyof F as  F[K]["_defined"] extends { required: false }
      ? K
      : never]?: _output<F[K]>;
    } & {
      [K in keyof F as TailorDBFieldReference<F[K]> extends never
      ? never
      : TailorDBFieldReference<F[K]>["nameMap"][0]]: _output<TailorDBFieldReference<F[K]>["type"]>;
    }
  >;

  constructor(
    public readonly name: string,
    public readonly fields: F,
    public readonly options: DBTypeOptions = {},
  ) {
    if (this.options.withTimestamps) {
      this.fields = { ...this.fields, ...datetimeFields };
    }

    const metadataFields = Object.entries(this.fields).reduce(
      (acc, [key, field]) => {
        acc[key] = field.config;
        return acc;
      },
      {} as Record<string, TailorDBType_FieldConfig>,
    );
    this.metadata = new TDB({
      name,
      schema: {
        description: options.description,
        extends: false,
        fields: metadataFields,
      },
    });
  }

  private referencedFields: FieldMetadata[] = [];

  toSDLMetadata(): TypeMetadata {
    return {
      name: this.name,
      fields: [
        ...Object.entries(this.fields).flatMap(([name, field]) =>
          field.toSDLMetadata().map((f) => ({
            name,
            ...f,
          })),
        ),
        ...this.referencedFields
      ],
      isInput: false,
    };
  }
}
type TailorDBDef = InstanceType<
  typeof TailorDBType<
    Record<
      string,
      TailorDBField<
        Partial<TailorDBFieldMetadata>,
        any,
        any
      >
    >
  >
>;

function isDBType(type: any): type is InstanceType<typeof TailorDBType> {
  return type instanceof TailorDBType;
}

const idField = uuid();
type idField = typeof idField;
const datetimeFields = {
  createdAt: datetime().hooks({
    create: () => new Date().toISOString(),
  }),
  updatedAt: datetime().hooks({
    update: () => new Date().toISOString(),
  }),
} as const satisfies Record<string, TailorDBField<any, any, any>>;
type DBType<
F extends { id?: never } & Record<string, TailorDBField<any, any, any>>,
O extends DBTypeOptions = {}> = O extends { withTimestamps: true }
  ? TailorDBType<{ id: idField } & F & typeof datetimeFields>
  : TailorDBType<{ id: idField } & F>

function dbType<
  const F extends { id?: never } & Record<string, TailorDBField<any, any, any>>,
  const O extends DBTypeOptions,
>(name: string, fields: F, options?: O): DBType<F, O> {
  if (options?.withTimestamps) {
    return new TailorDBType<{ id: idField } & F & typeof datetimeFields>(name, { id: idField, ...fields, ...datetimeFields }, options);
  }
  return new TailorDBType<F>(name, { id: idField, ...fields}, options) as DBType<F, O>;
}

const t = {
  dbType,
  uuid,
  string,
  bool,
  int,
  float,
  date,
  datetime,
  enum: _enum,
};

export default t;

export {
  t,
  dbType,
  uuid,
  string,
  bool,
  int,
  float,
  date,
  datetime,
  _enum as enum,
  _output as output,
  _output as infer,
  TailorDBDef,
  isDBType,
};

export namespace t {
  export type output<T> = _output<T>;
  export type infer<T> = _output<T>;
}
