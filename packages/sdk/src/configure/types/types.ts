import { type AllowedValue } from "./field";
import type { FieldValidateInput } from "./validation";

export interface SecretValue {
  vaultName: string;
  secretKey: string;
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
  datetime: string | Date;
  time: string;
  enum: string;
  object: Record<string, unknown>;
  nested: Record<string, unknown>;
} & Record<TailorFieldType, unknown>;

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

export interface FieldMetadata {
  description?: string;
  required?: boolean;
  array?: boolean;
  allowedValues?: AllowedValue[];
  validate?: FieldValidateInput<any>[];
  typeName?: string;
}

export interface DefinedFieldMetadata {
  type: TailorFieldType;
  array: boolean;
  description?: boolean;
  validate?: boolean;
  typeName?: boolean;
}

export type FieldOptions = {
  optional?: boolean;
  array?: boolean;
};

// Return Output type based on FieldOptions.
export type FieldOutput<T, O extends FieldOptions> = OptionalFieldOutput<ArrayFieldOutput<T, O>, O>;

type OptionalFieldOutput<T, O extends FieldOptions> = O["optional"] extends true ? T | null : T;

export type ArrayFieldOutput<T, O extends FieldOptions> = [O] extends [
  {
    array: true;
  },
]
  ? T[]
  : T;
