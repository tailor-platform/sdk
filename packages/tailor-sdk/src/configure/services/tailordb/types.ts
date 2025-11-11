import { type TailorUser } from "@/configure/types";
import { type output, type Prettify } from "@/configure/types/helpers";
import {
  type DefinedFieldMetadata,
  type FieldMetadata,
} from "@/configure/types/types";
import { type TailorDBField } from "./schema";
import type { NonEmptyObject } from "type-fest";

export type SerialConfig<
  T extends "string" | "integer" = "string" | "integer",
> = Prettify<
  {
    start: number;
    maxValue?: number;
  } & (T extends "string"
    ? {
        format?: string;
      }
    : object)
>;

export interface DBFieldMetadata extends FieldMetadata {
  index?: boolean;
  unique?: boolean;
  vector?: boolean;
  foreignKey?: boolean;
  foreignKeyType?: string;
  foreignKeyField?: string;
  hooks?: Hook<any, any>;
  serial?: SerialConfig;
  relation?: boolean;
}

export interface DefinedDBFieldMetadata extends DefinedFieldMetadata {
  index?: boolean;
  unique?: boolean;
  vector?: boolean;
  foreignKey?: boolean;
  foreignKeyType?: boolean;
  validate?: boolean;
  hooks?: {
    create: boolean;
    update: boolean;
  };
  serial?: boolean;
  relation?: boolean;
}

export type ExcludeNestedDBFields<
  T extends Record<string, TailorDBField<any, any>>,
> = {
  [K in keyof T]: T[K] extends TailorDBField<
    { type: "nested"; array: boolean },
    any
  >
    ? never
    : T[K];
};

type HookFn<TValue, TData, TReturn> = (args: {
  value: TValue;
  data: TData extends Record<string, unknown>
    ? { readonly [K in keyof TData]?: TData[K] | null | undefined }
    : unknown;
  user: TailorUser;
}) => TReturn;

export type Hook<TData, TReturn> = {
  create?: HookFn<TReturn | null, TData, TReturn>;
  update?: HookFn<TReturn | null, TData, TReturn>;
};

export type Hooks<
  F extends Record<string, TailorDBField<any, any>>,
  TData = { [K in keyof F]: output<F[K]> },
> = NonEmptyObject<{
  [K in Exclude<keyof F, "id"> as F[K]["_defined"] extends {
    hooks: unknown;
  }
    ? never
    : F[K]["_defined"] extends { type: "nested" }
      ? never
      : K]?: Hook<TData, output<F[K]>>;
}>;

export type TailorDBServiceConfig = { files: string[]; ignores?: string[] };
export type TailorDBServiceInput = {
  [namespace: string]: TailorDBServiceConfig;
};

export type IndexDef<T extends { fields: Record<PropertyKey, unknown> }> = {
  fields: [keyof T["fields"], keyof T["fields"], ...(keyof T["fields"])[]];
  unique?: boolean;
  name?: string;
};

export interface TypeFeatures {
  pluralForm?: string;
  aggregation?: true;
  bulkUpsert?: true;
}
