import {
  Script,
  TailorDBType as TDB,
  TailorDBType_FieldConfig,
  TailorDBType_FieldHook,
  TailorDBType_ValidateConfig,
} from "@tailor-inc/operator-client";
import { DBFieldMetadata, FieldValidateFn } from "./types";
import {
  FieldMetadata,
  TailorField,
  tailorToGraphQL,
  TailorToTs,
  TypeMetadata,
  User,
} from "../../types";
import type { DeepWriteable, output, Prettify } from "../../types/helpers";
import {
  AllowedValues,
  AllowedValuesOutput,
  mapAllowedValues,
} from "../../types/field";
import { ReferenceConfig } from "../../types/type";

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
} as const satisfies Omit<DBFieldMetadata, "type">;

class TailorDBField<
  const Defined extends Partial<DBFieldMetadata>,
  const Output,
  const Reference extends
    | ReferenceConfig<
      TailorDBType<
        & { id?: never }
        & Record<string, TailorDBField<Partial<DBFieldMetadata>, any, any>>
      >
    >
    | undefined,
> {
  protected _metadata: DBFieldMetadata;
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
        })
        : undefined,
    });
  }

  get reference(): Readonly<Reference> | null {
    return this._ref ? structuredClone(this._ref) : null;
  }

  private constructor(type: TailorField) {
    this._metadata = { type, required: true };
  }

  static create<
    const T extends TailorField,
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
    this: CurrentDefined extends { required: unknown } ? never
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
    this: CurrentDefined extends { description: unknown } ? never
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
    this: CurrentDefined extends { array: unknown } ? never
      : TailorDBField<CurrentDefined, Output, Reference>,
  ) {
    this._metadata.array = true;
    return this as TailorDBField<
      Prettify<CurrentDefined & { array: true }>,
      Output,
      Reference
    >;
  }

  index<CurrentDefined extends Defined>(
    this: CurrentDefined extends { index: unknown } ? never
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
    this: CurrentDefined extends { unique: unknown } ? never
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
    this: CurrentDefined extends { vector: unknown } ? never
      : TailorDBField<CurrentDefined, Output, Reference>,
  ) {
    this._metadata.vector = true;
    return this as TailorDBField<
      Prettify<CurrentDefined & { vector: true }>,
      Output,
      Reference
    >;
  }

  values<CurrentDefined extends Defined, const V extends AllowedValues>(
    this: CurrentDefined extends { allowedValues: unknown } ? never
      : TailorDBField<CurrentDefined, Output, Reference>,
    values: V,
  ) {
    this._metadata.allowedValues = mapAllowedValues(values);
    return this as unknown as TailorDBField<
      Prettify<CurrentDefined & { allowedValues: V }>,
      AllowedValuesOutput<V>,
      Reference
    >;
  }

  validate<
    const V extends FieldValidateFn<Output>[],
    CurrentDefined extends Defined,
  >(
    this: CurrentDefined extends { validate: unknown } ? never
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
    CurrentDefined extends Defined,
  >(
    this: CurrentDefined extends { hooks: unknown } ? never
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

  ref<
    const M extends [string, string],
    const T extends InstanceType<typeof TailorDBType<any>>,
    const F extends keyof T["fields"] & string,
    CurrentDefined extends Defined,
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
      { nameMap: M; type: T; field: F }
    >;
  }

  toSDLMetadata(): (Omit<FieldMetadata, "name"> & { name?: string })[] {
    return [
      {
        type: tailorToGraphQL[this._metadata.type],
        elementType: tailorToGraphQL[this._metadata.type],
        isNullable: !this._metadata.required,
        isList: !!this._metadata.array,
      },
      ...(this._ref
        ? [{
          name: this._ref.nameMap[0],
          type: this._ref.type.name,
          elementType: this._ref.type.name,
          isNullable: !this._metadata.required,
          isList: !!this._metadata.array,
        }]
        : []),
    ];
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

function _enum<const V extends AllowedValues>(values: V) {
  return createField("enum", []).values(values);
}

type FieldReference<T extends TailorDBField<any, any, any>> = DeepWriteable<
  NonNullable<T["reference"]>
>;

type DBTypeOptions = {
  withTimestamps?: boolean;
  description?: string;
};

class TailorDBType<
  const F extends
    & { id?: never }
    & Record<
      string,
      TailorDBField<
        Partial<DBFieldMetadata>,
        any,
        any
      >
    >,
> {
  public readonly metadata: TDB;
  public readonly _output = null as unknown as Prettify<
    & {
      [
        K in keyof F as F[K]["_defined"] extends { required: false } ? never
          : K
      ]: output<F[K]>;
    }
    & {
      [
        K in keyof F as F[K]["_defined"] extends { required: false } ? K
          : never
      ]?: output<F[K]>;
    }
    & {
      [
        K in keyof F as FieldReference<F[K]> extends never ? never
          : FieldReference<F[K]>["nameMap"][0]
      ]: output<FieldReference<F[K]>["type"]>;
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
          }))
        ),
        ...this.referencedFields,
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
        Partial<DBFieldMetadata>,
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
  O extends DBTypeOptions = {},
> = O extends { withTimestamps: true }
  ? TailorDBType<{ id: idField } & F & typeof datetimeFields>
  : TailorDBType<{ id: idField } & F>;

function dbType<
  const F extends { id?: never } & Record<string, TailorDBField<any, any, any>>,
  const O extends DBTypeOptions,
>(name: string, fields: F, options?: O): DBType<F, O> {
  if (options?.withTimestamps) {
    return new TailorDBType<{ id: idField } & F & typeof datetimeFields>(name, {
      id: idField,
      ...fields,
      ...datetimeFields,
    }, options);
  }
  return new TailorDBType<F>(
    name,
    { id: idField, ...fields },
    options,
  ) as DBType<F, O>;
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
  _enum as enum,
  bool,
  date,
  datetime,
  dbType,
  float,
  int,
  isDBType,
  string,
  t,
  TailorDBDef,
  uuid,
};
