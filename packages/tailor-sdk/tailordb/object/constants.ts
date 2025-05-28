import { TailorDBFieldType, TailorDB2GraphQL } from "./types";

export const typeMapping: Record<string, TailorDBFieldType> = {
  String: "string",
  string: "string",
  Number: "integer",
  number: "integer",
  Boolean: "bool",
  boolean: "bool",
} as const;

export const tailor2gql = {
  string: "String",
  integer: "Int",
  float: "Float",
  bool: "Boolean",
  uuid: "ID",
  date: "Date",
  datetime: "DateTime",
  enum: "enum",
} as const satisfies TailorDB2GraphQL;
