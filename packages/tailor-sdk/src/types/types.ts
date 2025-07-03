import { AllowedValue } from "./field";

export type Region = "asia-northeast" | "us-west";

export type TailorFieldType =
  | "uuid"
  | "string"
  | "bool"
  | "integer"
  | "float"
  | "enum"
  | "date"
  | "datetime"
  | "nested";

export type TailorToTs = {
  string: string;
  integer: number;
  float: number;
  bool: boolean;
  uuid: string;
  date: Date;
  datetime: Date;
  enum: string;
  object: Record<string, unknown>;
  nested: Record<string, unknown>;
} & Record<TailorFieldType, unknown>;

export const tailorToGraphQL = {
  string: "String",
  integer: "Int",
  float: "Float",
  bool: "Boolean",
  boolean: "Boolean",
  uuid: "ID",
  date: "Date",
  datetime: "DateTime",
  enum: "enum",
  nested: "JSON",
} as const;

// Manifest用の型マッピング（mapTypeToScalarの代替）
export const tailorToManifestScalar = {
  string: "string",
  integer: "integer",
  float: "float",
  bool: "boolean",
  boolean: "boolean",
  uuid: "uuid",
  date: "date",
  datetime: "datetime",
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

export const scalarTypes = [
  "String",
  "Int",
  "Float",
  "Boolean",
  "ID",
  "JSON",
  "Date",
  "Time",
  "DateTime",
];

export interface FieldMetadata {
  description?: string;
  type: TailorFieldType;
  required?: boolean;
  array?: boolean;
  allowedValues?: AllowedValue[];
  assertNonNull?: boolean;
}
