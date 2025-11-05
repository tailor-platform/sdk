import {
  type AllowedValues,
  type AllowedValuesOutput,
  mapAllowedValues,
} from "./field";
import {
  type TailorFieldType,
  type TailorToTs,
  type FieldMetadata,
  type DefinedFieldMetadata,
  type FieldOptions,
  type FieldOutput,
} from "./types";
import type { Prettify, InferFieldsOutput } from "./helpers";
import type { FieldValidateInput } from "./validation";
import type { TailorFieldInput } from "@/parser/service/pipeline/types";

export class TailorField<
  const Defined extends DefinedFieldMetadata = DefinedFieldMetadata,
  const Output = any,
  M extends FieldMetadata = FieldMetadata,
> implements TailorFieldInput
{
  protected _metadata: M;
  public readonly _defined: Defined = undefined as unknown as Defined;
  public readonly _output = undefined as Output;

  get metadata() {
    return { ...this._metadata };
  }

  protected constructor(
    public readonly type: TailorFieldType,
    options?: FieldOptions,
    public readonly fields: Record<string, TailorField<any>> = {},
    values?: AllowedValues,
  ) {
    this._metadata = { required: true } as M;
    if (options) {
      if (options.optional === true) {
        this._metadata.required = false;
      }
      if (options.array === true) {
        this._metadata.array = true;
      }
    }
    if (values) {
      this._metadata.allowedValues = mapAllowedValues(values);
    }
  }

  static create<
    const TType extends TailorFieldType,
    const TOptions extends FieldOptions,
  >(
    type: TType,
    options?: TOptions,
    fields?: Record<string, TailorField<any>>,
    values?: AllowedValues,
  ) {
    return new TailorField<
      { type: TType; array: TOptions extends { array: true } ? true : false },
      FieldOutput<TailorToTs[TType], TOptions>
    >(type, options, fields, values);
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

  typeName<CurrentDefined extends Defined>(
    this: CurrentDefined extends { typeName: unknown }
      ? never
      : CurrentDefined extends { type: "enum" | "nested" }
        ? TailorField<CurrentDefined, Output>
        : never,
    typeName: string,
  ) {
    this._metadata.typeName = typeName;
    return this as TailorField<
      Prettify<CurrentDefined & { typeName: true }>,
      Output
    >;
  }

  validate<CurrentDefined extends Defined>(
    this: CurrentDefined extends { validate: unknown }
      ? never
      : TailorField<CurrentDefined, Output>,
    ...validate: FieldValidateInput<Output>[]
  ) {
    this._metadata.validate = validate;
    return this as TailorField<
      Prettify<CurrentDefined & { validate: true }>,
      Output
    >;
  }
}

const createField = TailorField.create;
function uuid<const Opt extends FieldOptions>(options?: Opt) {
  return createField("uuid", options);
}

function string<const Opt extends FieldOptions>(options?: Opt) {
  return createField("string", options);
}

function bool<const Opt extends FieldOptions>(options?: Opt) {
  return createField("boolean", options);
}

function int<const Opt extends FieldOptions>(options?: Opt) {
  return createField("integer", options);
}

function float<const Opt extends FieldOptions>(options?: Opt) {
  return createField("float", options);
}

function date<const Opt extends FieldOptions>(options?: Opt) {
  return createField("date", options);
}

function datetime<const Opt extends FieldOptions>(options?: Opt) {
  return createField("datetime", options);
}

function time<const Opt extends FieldOptions>(options?: Opt) {
  return createField("time", options);
}

function _enum<const V extends AllowedValues>(
  ...values: V
): TailorField<
  { type: "enum"; array: false },
  FieldOutput<AllowedValuesOutput<V>, { optional: false; array: false }>
>;
function _enum<const V extends AllowedValues, const Opt extends FieldOptions>(
  ...args: [...V, Opt]
): TailorField<
  { type: "enum"; array: Opt extends { array: true } ? true : false },
  FieldOutput<AllowedValuesOutput<V>, Opt>
>;
function _enum(
  ...args: (AllowedValues[number] | FieldOptions)[]
): TailorField<{ type: "enum"; array: boolean }, any> {
  let values: AllowedValues;
  let options: FieldOptions | undefined;
  const lastArg = args[args.length - 1];
  if (typeof lastArg === "object" && !("value" in lastArg)) {
    values = args.slice(0, -1) as AllowedValues;
    options = lastArg;
  } else {
    values = args as AllowedValues;
    options = undefined;
  }
  return createField("enum", options, undefined, values);
}

function object<
  const F extends Record<string, TailorField<any>>,
  const Opt extends FieldOptions,
>(fields: F, options?: Opt) {
  const objectField = createField("nested", options, fields) as TailorField<
    { type: "nested"; array: Opt extends { array: true } ? true : false },
    FieldOutput<InferFieldsOutput<F>, Opt>
  >;
  return objectField;
}

export const t = {
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
