import {
  type TailorFieldType,
  type TailorToTs,
  type FieldMetadata,
  type NullableToOptional,
  type InferFieldOutput,
  type DefinedFieldMetadata,
} from "./types";
import type { Prettify } from "./helpers";
import {
  type AllowedValues,
  type AllowedValuesOutput,
  mapAllowedValues,
} from "./field";

export class TailorType<
  const F extends Record<string, TailorField<any>> = any,
  Output = Prettify<
    NullableToOptional<{
      [K in keyof F]: InferFieldOutput<F[K]>;
    }>
  >,
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

  protected constructor(
    type: TailorFieldType,
    public readonly fields?: Record<string, TailorField<any>>,
    values?: AllowedValues,
  ) {
    this._metadata = { type, required: true } as M;
    if (values) {
      this._metadata.allowedValues = mapAllowedValues(values);
    }
  }

  static create<const T extends TailorFieldType>(
    type: T,
    fields?: Record<string, TailorField<any>>,
    values?: AllowedValues,
  ) {
    return new TailorField<{ type: T }, TailorToTs[T]>(type, fields, values);
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
  ) {
    this._metadata.required = false;
    if (options?.assertNonNull === true) {
      this._metadata.assertNonNull = true;
    }
    return this as TailorField<
      Prettify<
        CurrentDefined & { required: false; assertNonNull: O["assertNonNull"] }
      >,
      Output
    >;
  }

  description<CurrentDefined extends Defined>(
    this: CurrentDefined extends { description: unknown }
      ? never
      : TailorField<CurrentDefined, Output>,
    description: string,
  ) {
    this._metadata.description = description;
    return this as TailorField<
      Prettify<CurrentDefined & { description: true }>,
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
}

const createField = TailorField.create;
function uuid() {
  return createField("uuid");
}

function string() {
  return createField("string");
}

function bool() {
  return createField("boolean");
}

function int() {
  return createField("integer");
}

function float() {
  return createField("float");
}

function date() {
  return createField("date");
}

function datetime() {
  return createField("datetime");
}

function time() {
  return createField("time");
}

function _enum<const V extends AllowedValues>(values: V) {
  return createField("enum", undefined, values) as TailorField<
    { type: "enum" },
    AllowedValuesOutput<V>
  >;
}

function object<const F extends Record<string, TailorField<any>>>(fields: F) {
  const objectField = createField("nested", fields) as TailorField<
    { type: "nested" },
    Prettify<
      NullableToOptional<{
        [K in keyof F]: InferFieldOutput<F[K]>;
      }>
    >
  >;
  return objectField;
}

function tailorType<const F extends Record<string, TailorField<any>>>(
  fields: F,
): TailorType<F> {
  return new TailorType<F>(fields);
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
  time,
  enum: _enum,
  object,
};
export default t;
export { t, tailorType as type, _enum as enum };
