import { TailorFieldType, TailorToTs, FieldMetadata } from "./types";
import type { output, Prettify } from "./helpers";
import { AllowedValues, AllowedValuesOutput, mapAllowedValues } from "./field";

type DefinedFieldMetadata = Partial<
  Omit<FieldMetadata, "allowedValues"> & { allowedValues: string[] }
>;

const fieldDefaults = {
  required: true,
  description: undefined,
  allowedValues: undefined,
  array: undefined,
} as const satisfies Omit<FieldMetadata, "type">;

export type TailorTypeOutput<
  M extends DefinedFieldMetadata,
  F extends Record<string, TailorField<M>>,
> = {
  [K in keyof F as F[K]["_defined"] extends { required: false }
    ? never
    : K]: output<F[K]>;
} & {
  [K in keyof F as F[K]["_defined"] extends { required: false }
    ? K
    : never]?: output<F[K]> | null;
};
export class TailorType<
  M extends DefinedFieldMetadata = DefinedFieldMetadata,
  const F extends Record<string, TailorField<M>> = any,
  Output = Prettify<TailorTypeOutput<M, F>>,
> {
  public readonly _output = null as unknown as Output;

  constructor(public readonly fields: F) {}
}

export class TailorField<
  const Defined extends DefinedFieldMetadata = DefinedFieldMetadata,
  const Output = any,
  M extends FieldMetadata = FieldMetadata,
> {
  protected _metadata: M;
  public readonly _defined: Defined = undefined as unknown as Defined;
  public readonly _output = undefined as Output;

  get metadata() {
    return { ...this._metadata };
  }

  protected constructor(type: TailorFieldType) {
    this._metadata = { ...fieldDefaults, type } as M;
  }

  static create<
    const T extends TailorFieldType,
    const D extends (keyof FieldMetadata)[],
  >(type: T, _defines: D) {
    return new TailorField<
      Prettify<
        Pick<typeof fieldDefaults, Exclude<D[number], "type">> & {
          type: T;
        }
      >,
      TailorToTs[T]
    >(type);
  }

  optional<CurrentDefined extends Defined>(
    this: CurrentDefined extends { required: unknown }
      ? never
      : TailorField<CurrentDefined, Output>,
  ) {
    this._metadata.required = false;
    return this as TailorField<
      Prettify<CurrentDefined & { required: false }>,
      Output
    >;
  }

  description<const D extends string, CurrentDefined extends Defined>(
    this: CurrentDefined extends { description: unknown }
      ? never
      : TailorField<CurrentDefined, Output>,
    description: D,
  ) {
    this._metadata.description = description;
    return this as unknown as TailorField<
      Prettify<CurrentDefined & { description: D }>,
      Output
    >;
  }

  array<CurrentDefined extends Defined>(
    this: CurrentDefined extends { array: unknown }
      ? never
      : TailorField<CurrentDefined, Output>,
  ) {
    this._metadata.array = true;
    return this as TailorField<
      Prettify<CurrentDefined & { array: true }>,
      Output[]
    >;
  }

  values<CurrentDefined extends Defined, const V extends AllowedValues>(
    this: CurrentDefined extends { allowedValues: unknown }
      ? never
      : TailorField<CurrentDefined, Output>,
    values: V,
  ) {
    this._metadata.allowedValues = mapAllowedValues(values);
    return this as unknown as TailorField<
      Prettify<CurrentDefined & { allowedValues: V }>,
      AllowedValuesOutput<V>
    >;
  }
}

const createField = TailorField.create;
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

type TailorTypeDef = InstanceType<
  typeof TailorType<
    DefinedFieldMetadata,
    Record<string, TailorField<DefinedFieldMetadata>>
  >
>;

function tailorType<const F extends Record<string, TailorField>>(
  fields: F,
): TailorType<DefinedFieldMetadata, F> {
  return new TailorType<DefinedFieldMetadata, F>(fields) as TailorType<
    DefinedFieldMetadata,
    F
  >;
}

const t = {
  type: tailorType,
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
  tailorType as type,
  uuid,
  string,
  bool,
  int,
  float,
  date,
  datetime,
  _enum as enum,
  TailorTypeDef,
};
