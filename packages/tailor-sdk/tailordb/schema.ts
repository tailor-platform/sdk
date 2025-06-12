import {
  Script,
  TailorDBType as TDB,
  TailorDBType_FieldConfig,
  TailorDBType_FieldHook,
  TailorDBType_ValidateConfig,
} from "@tailor-inc/operator-client";
import {
  DBFieldMetadata,
  DefinedFieldMetadata,
  FieldValidateFn,
} from "./types";
import {
  SDLFieldMetadata,
  SDLTypeMetadata,
  TailorFieldType,
  tailorToGraphQL,
  TailorToTs,
} from "../types/types";
import type { DeepWriteable, Prettify } from "../types/helpers";
import { AllowedValues, AllowedValuesOutput } from "../types/field";
import { ReferenceConfig, TailorField, TailorType } from "../types/type";

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
  const Defined extends DefinedFieldMetadata,
  const Output,
  const Reference extends
    | ReferenceConfig<any>
    | undefined,
> extends TailorField<Defined, Output, Reference, DBFieldMetadata> {
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

  private constructor(type: TailorFieldType) {
    super(type);
    this._metadata = { type, required: true };
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
    this: CurrentDefined extends { required: unknown } ? never
      : TailorField<CurrentDefined, Output, Reference>,
  ): TailorDBField<
    Prettify<CurrentDefined & { required: false }>,
    Output,
    Reference
  > {
    return super.optional() as any;
  }

  description<const D extends string, CurrentDefined extends Defined>(
    this: CurrentDefined extends { description: unknown } ? never
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
    this: CurrentDefined extends { array: unknown } ? never
      : TailorField<CurrentDefined, Output, Reference>,
  ): TailorDBField<
    Prettify<CurrentDefined & { array: true }>,
    Output,
    Reference
  > {
    return super.array() as any;
  }

  values<CurrentDefined extends Defined, const V extends AllowedValues>(
    this: CurrentDefined extends { allowedValues: unknown } ? never
      : TailorField<CurrentDefined, Output, Reference>,
    values: V,
  ): TailorDBField<
    Prettify<CurrentDefined & { allowedValues: V }>,
    AllowedValuesOutput<V>,
    Reference
  > {
    return super.values(values) as any;
  }

  ref<
    const M extends [string, string],
    const T extends TailorType<any, any>,
    const F extends keyof T["fields"] & string,
    CurrentDefined extends Defined,
  >(
    this: Reference extends undefined
      ? TailorField<CurrentDefined, Output, Reference>
      : never,
    type: T,
    nameMap: M,
    field: F = "id" as F,
  ): TailorDBField<
    CurrentDefined,
    Output,
    { nameMap: M; type: T; field: F }
  > {
    return super.ref(type, nameMap, field) as any;
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

  toSDLMetadata(): (Omit<SDLFieldMetadata, "name"> & { name?: string })[] {
    const ref = this.reference as any;
    return [
      {
        type: tailorToGraphQL[this._metadata.type],
        required: this._metadata.required ?? true,
        array: this._metadata.array ?? false,
      },
      ...(ref
        ? [{
          name: ref.nameMap[0],
          type: ref.type.name,
          required: this._metadata.required ?? true,
          array: this._metadata.array ?? false,
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
        M,
        any,
        any
      >
    >,
  M extends DefinedFieldMetadata,
> extends TailorType<M, F & Record<string, TailorField<M, any, any>>> {
  public readonly metadata: TDB;

  constructor(
    public readonly name: string,
    public readonly fields: F,
    public readonly options: DBTypeOptions = {},
  ) {
    super(name, fields);

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

  toSDLMetadata(): SDLTypeMetadata {
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
    Record<string, TailorDBField<DefinedFieldMetadata, any, any>>,
    DefinedFieldMetadata
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
> = O extends { withTimestamps: true } ? TailorDBType<
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
    >(name, {
      id: idField,
      ...fields,
      ...datetimeFields,
    }, options);
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
  isDBType,
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
  isDBType,
  string,
  TailorDBDef,
  uuid,
};
