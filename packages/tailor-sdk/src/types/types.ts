import { type AllowedValue } from "./field";
import { type DeepWritable, type Prettify } from "./helpers";
import { type TailorField, type TailorType } from "./type";

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
  required?: boolean;
  array?: boolean;
  assertNonNull?: boolean;
}

// Derive the output type for TailorField considering optional().
// When assertNonNull is set, we assume that the value is injected by hooks and never null.
// TODO(remiposo): Since array() directly modify type parameter (O), it would be better to unify them.
export type InferFieldOutput<T extends TailorField<any>> =
  T extends TailorField<any, infer O>
    ? DeepWritable<
        T["_defined"] extends { required: false }
          ? T["_defined"] extends { assertNonNull: true }
            ? O
            : O | null
          : O
      >
    : never;

// Derive the input type for TailorField considering optional().
// TODO(remiposo): Since array() directly modify type parameter(infer O), it would be better to unify them.
export type InferFieldInput<T extends TailorField<any>> =
  T extends TailorField<any, infer O>
    ? DeepWritable<T["_defined"] extends { required: false } ? O | null : O>
    : never;

// Derive the input type for TailorType.
// NOTE(remiposo): Like output<T>, this might be worth making public.
export type InferTypeInput<T extends TailorType> =
  T extends TailorType<infer F>
    ? DeepWritable<
        Prettify<
          NullableToOptional<{
            [K in keyof F]: InferFieldInput<F[K]>;
          }>
        >
      >
    : never;

export type NullableToOptional<T> = {
  [K in keyof T as null extends T[K] ? never : K]: T[K];
} & {
  [K in keyof T as null extends T[K] ? K : never]?: T[K];
};
