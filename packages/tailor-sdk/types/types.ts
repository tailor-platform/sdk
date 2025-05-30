import { AllowedValue } from "./field";

export type TailorFieldType =
  | "uuid"
  | "string"
  | "bool"
  | "integer"
  | "float"
  | "enum"
  | "date"
  | "datetime";

export type TailorToTs = {
  string: string;
  integer: number;
  float: number;
  bool: boolean;
  uuid: string;
  date: Date;
  datetime: Date;
  enum: string;
} & Record<TailorFieldType, unknown>;

export const typeMapping: Record<string, TailorFieldType> = {
  String: "string",
  string: "string",
  Number: "integer",
  number: "integer",
  Boolean: "bool",
  boolean: "bool",
} as const;

export const tailorToGraphQL = {
  string: "String",
  integer: "Int",
  float: "Float",
  bool: "Boolean",
  uuid: "ID",
  date: "Date",
  datetime: "DateTime",
  enum: "enum",
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

export interface SDLTypeMetadata {
  name: string;
  fields: SDLFieldMetadata[];
  isInput: boolean;
}

export interface SDLFieldMetadata {
  name: string;
  description?: string;
  type: GraphQLType;
  required: boolean;
  array: boolean;
}

export interface FieldMetadata {
  description?: string;
  type: TailorFieldType;
  required?: boolean;
  array?: boolean;
  allowedValues?: AllowedValue[];
}
