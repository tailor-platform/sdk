import { AllowedValue } from "./field";

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

export const tailorToGraphQL = {
  string: "String",
  integer: "Int",
  float: "Float",
  boolean: "Boolean",
  uuid: "ID",
  date: "Date",
  datetime: "DateTime",
  time: "Time",
  enum: "enum",
  nested: "JSON",
} as const;

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
export type tailorToGraphQL = typeof tailorToGraphQL;

export type GraphQLType =
  | "String"
  | "Int"
  | "Float"
  | "Boolean"
  | "ID"
  | string;

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
