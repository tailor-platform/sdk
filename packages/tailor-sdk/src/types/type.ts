/* eslint-disable @typescript-eslint/no-unused-vars */

import {
  type TailorFieldType,
  type TailorToTs,
  type FieldMetadata,
  type NullableToOptional,
  type InferFieldOutput,
} from "./types";
import type { output, Prettify } from "./helpers";
import {
  type AllowedValues,
  type AllowedValuesOutput,
  mapAllowedValues,
} from "./field";

type DefinedFieldMetadata = Partial<
  Omit<FieldMetadata, "allowedValues"> & { allowedValues: string[] }
>;

const fieldDefaults = {
  required: undefined,
  description: undefined,
  allowedValues: undefined,
  array: undefined,
  assertNonNull: undefined,
} as const satisfies Omit<FieldMetadata, "type">;

export class TailorType<
  M extends DefinedFieldMetadata = DefinedFieldMetadata,
  const F extends Record<string, TailorField<M>> = any,
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
    public readonly fields?: Record<string, TailorField<any, any>>,
  ) {
    this._metadata = { type, required: true } as M;
  }

  static create<
    const T extends TailorFieldType,
    const D extends (keyof FieldMetadata)[],
  >(type: T, _defines: D, fields?: Record<string, TailorField<any, any>>) {
    return new TailorField<
      Prettify<
        Pick<typeof fieldDefaults, Exclude<D[number], "name" | "type">> & {
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

function _enum<const V extends AllowedValues>(values: V) {
  return createField("enum", []).values(values);
}

function object<const F extends Record<string, TailorField<any, any>>>(
  fields: F,
) {
  const objectField = createField(
    "nested",
    ["allowedValues"],
    fields,
  ) as TailorField<
    DefinedFieldMetadata & { type: "nested" },
    Prettify<
      NullableToOptional<{
        [K in keyof F]: InferFieldOutput<F[K]>;
      }>
    >
  >;
  return objectField;
}

function tailorType<const F extends Record<string, TailorField<any, any>>>(
  fields: F,
): TailorType<DefinedFieldMetadata, F> {
  return new TailorType<DefinedFieldMetadata, F>(fields);
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
