import { type AllowedValue } from "./field";
import {
  type output,
  type DeepWritable,
  type Prettify,
  type NullableToOptional,
} from "./helpers";
import { type TailorField } from "./type";

export type Region = "asia-northeast" | "us-west";

// Secret manager types
export interface SecretValue {
  VaultName: string;
  SecretKey: string;
}

export type TailorFieldType =
  | "uuid"
  | "string"
  | "boolean"
  | "integer"
  | "float"
  | "enum"
  | "date"
  | "datetime"
  | "time"
  | "nested";

export type TailorToTs = {
  string: string;
  integer: number;
  float: number;
  boolean: boolean;
  uuid: string;
  date: string;
  datetime: string;
  time: string;
  enum: string;
  object: Record<string, unknown>;
  nested: Record<string, unknown>;
} & Record<TailorFieldType, unknown>;

// Manifest用の型マッピング（mapTypeToScalarの代替）
export const tailorToManifestScalar = {
  string: "string",
  integer: "integer",
  float: "float",
  boolean: "boolean",
  uuid: "uuid",
  date: "date",
  datetime: "datetime",
  time: "time",
  enum: "enum",
  nested: "nested",
} as const;

// Common types for operator and SDK
export interface Script {
  expr: string;
}

export interface EnumValue {
  value: string;
  description?: string;
}

export interface FieldMetadata {
  description?: string;
  type: TailorFieldType;
  required?: boolean;
  array?: boolean;
  allowedValues?: AllowedValue[];
  assertNonNull?: boolean;
}

export interface DefinedFieldMetadata {
  description?: boolean;
  type: TailorFieldType;
}

export type FieldOptions = (
  | {
      optional: true;
      assertNonNull?: boolean;
    }
  | {
      optional?: false;
    }
) & {
  array?: boolean;
};

// Return Output type based on FieldOptions.
// If assertNonNull is true, it returns non-nullable type.
export type FieldOutput<T, O extends FieldOptions> = OptionalFieldOutput<
  ArrayFieldOutput<T, O>,
  O
>;

type OptionalFieldOutput<T, O extends FieldOptions> = [O] extends [
  {
    optional: true;
    assertNonNull?: false;
  },
]
  ? T | null
  : T;

export type ArrayFieldOutput<T, O extends FieldOptions> = [O] extends [
  {
    array: true;
  },
]
  ? T[]
  : T;

// Return Output type for TailorFields.
export type InferFieldsOutput<F extends Record<string, TailorField<any, any>>> =
  DeepWritable<
    Prettify<
      NullableToOptional<{
        [K in keyof F]: output<F[K]>;
      }>
    >
  >;
