/* eslint-disable @typescript-eslint/no-unused-vars */

import { clone } from "es-toolkit";
import { TailorFieldType, TailorToTs, FieldMetadata } from "./types";
import type { DeepWriteable, output, Prettify } from "./helpers";
import { AllowedValues, AllowedValuesOutput, mapAllowedValues } from "./field";

type DefinedFieldMetadata = Partial<
  Omit<FieldMetadata, "allowedValues"> & { allowedValues: string[] }
>;

export type FieldReference<T extends TailorField<any, any, any>> =
  DeepWriteable<Exclude<T["reference"], null | undefined>>;

export type ReferenceConfig<
  T extends { _output: any; fields: Record<string, unknown> } = {
    _output: any;
    fields: Record<string, unknown>;
  },
  M extends [string, string] = [string, string],
  K extends keyof T["fields"] & string = keyof T["fields"] & string,
> = {
  nameMap: M;
  type: T;
  key: K;
};

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
    {
      [K in keyof F as F[K]["_defined"] extends { required: false }
        ? never
        : K]: output<F[K]>;
    } & {
      [K in keyof F as F[K]["_defined"] extends { required: false }
        ? F[K]["_defined"] extends { assertNonNull: true }
          ? never
          : K
        : never]?: output<F[K]> | null;
    } & {
      [K in keyof F as F[K]["_defined"] extends { required: false }
        ? F[K]["_defined"] extends { assertNonNull: true }
          ? K
          : never
        : never]-?: NonNullable<output<F[K]>>;
    } & {
      [K in keyof F as FieldReference<F[K]> extends ReferenceConfig<
        any,
        infer M
      >
        ? M[0]
        : never]: FieldReference<F[K]> extends ReferenceConfig<
        infer T extends { _output: any; fields: any }
      >
        ? T["_output"]
        : never;
    }
  >,
> {
  public readonly _output = null as unknown as Output;

  constructor(public readonly fields: F) {}
}

export class TailorField<
  const Defined extends DefinedFieldMetadata = DefinedFieldMetadata,
  const Output = any,
  const Reference extends
    | ReferenceConfig<
        TailorType<
          DefinedFieldMetadata,
          { id?: never } & Record<string, TailorField<DefinedFieldMetadata>>
        >
      >
    | undefined = undefined,
  M extends FieldMetadata = FieldMetadata,
> {
  protected _metadata: M;
  public readonly _defined: Defined = undefined as unknown as Defined;
  public readonly _output = undefined as Output;
  private _ref: Reference = undefined as Reference;

  get metadata() {
    return { ...this._metadata };
  }

  get reference(): Readonly<Reference> | null {
    return clone(this._ref);
  }

  protected constructor(
    type: TailorFieldType,
    public readonly fields?: Record<string, TailorField<any, any, any>>,
  ) {
    this._metadata = { type, required: true } as M;
  }

  static create<
    const T extends TailorFieldType,
    const D extends (keyof FieldMetadata)[],
  >(type: T, _defines: D, fields?: Record<string, TailorField<any, any, any>>) {
    return new TailorField<
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
  ) {
    this._metadata.required = false;
    if (options?.assertNonNull === true) {
      this._metadata.assertNonNull = true;
    }
    return this as TailorField<
      Prettify<
        CurrentDefined & { required: false; assertNonNull: O["assertNonNull"] }
      >,
      Output,
      Reference
    >;
  }

  description<const D extends string, CurrentDefined extends Defined>(
    this: CurrentDefined extends { description: unknown }
      ? never
      : TailorField<CurrentDefined, Output, Reference>,
    description: D,
  ) {
    this._metadata.description = description;
    return this as unknown as TailorField<
      Prettify<CurrentDefined & { description: D }>,
      Output,
      Reference
    >;
  }

  array<CurrentDefined extends Defined>(
    this: CurrentDefined extends { array: unknown }
      ? never
      : TailorField<CurrentDefined, Output, Reference>,
  ) {
    this._metadata.array = true;
    return this as TailorField<
      Prettify<CurrentDefined & { array: true }>,
      Output[],
      Reference
    >;
  }

  values<CurrentDefined extends Defined, const V extends AllowedValues>(
    this: CurrentDefined extends { allowedValues: unknown }
      ? never
      : TailorField<CurrentDefined, Output, Reference>,
    values: V,
  ) {
    this._metadata.allowedValues = mapAllowedValues(values);
    return this as unknown as TailorField<
      Prettify<CurrentDefined & { allowedValues: V }>,
      AllowedValuesOutput<V>,
      Reference
    >;
  }

  ref<
    const M extends [string, string],
    const T extends TailorType,
    const F extends keyof T["fields"] & string,
    CurrentDefined extends Defined,
  >(
    this: Reference extends undefined
      ? TailorField<CurrentDefined, Output, Reference>
      : never,
    type: T,
    nameMap: M,
    key: F = "id" as F,
  ) {
    (this as any)._ref = {
      nameMap,
      type,
      key,
    };
    return this as unknown as TailorField<
      CurrentDefined,
      Output,
      { nameMap: M; type: T; key: F }
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

function object<const F extends Record<string, TailorField<any, any, any>>>(
  fields: F,
) {
  const objectField = createField(
    "nested",
    ["allowedValues"],
    fields,
  ) as TailorField<
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

type TailorTypeDef = InstanceType<
  typeof TailorType<
    DefinedFieldMetadata,
    Record<string, TailorField<DefinedFieldMetadata, any, any>>
  >
>;

function tailorType<const F extends Record<string, TailorField<any, any, any>>>(
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
  object,
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
  object,
  TailorTypeDef,
};
