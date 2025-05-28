import { GraphQLType } from "../../schema-generator";

export type TailorDBFieldType =
  | "uuid"
  | "string"
  | "bool"
  | "integer"
  | "float"
  | "enum"
  | "date"
  | "datetime";

export type TailorDB2TS = {
  string: string;
  integer: number;
  float: number;
  bool: boolean;
  uuid: string;
  date: Date;
  datetime: Date;
  enum: string;
} & Record<TailorDBFieldType, unknown>;

export type TailorDB2GraphQL = {
  string: "String";
  integer: "Int";
  float: "Float";
  bool: "Boolean";
  uuid: "ID";
  date: "Date";
  datetime: "DateTime";
  enum: "enum";
} & Record<TailorDBFieldType, GraphQLType>;

export interface TailorDBTypeMetadata {
  name: string;
  fields: TailorDBFieldMetadata[];
}

export interface AllowedValue {
  value: string;
  description?: string;
}

export interface TailorDBFKMetadata { }

export type TailorDBFieldMetadata = {
  // name: string;
  description?: string;
  type: TailorDBFieldType;
  required?: boolean;
  allowedValues?: AllowedValue[];
  array?: boolean;
  index?: boolean;
  unique?: boolean;
  vector?: boolean;
  foreignKey?: boolean;
  validate?: Function[];
  hooks?: {
    create?: Function;
    update?: Function;
  };
};

export type TailorDBTypeConfig = {
  withTimestamps?: boolean;
};
