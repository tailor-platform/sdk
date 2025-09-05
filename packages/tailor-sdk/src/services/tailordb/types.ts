import { type TailorUser } from "@/types";
import { type output, type Prettify } from "@/types/helpers";
import {
  type FieldMetadata,
  type InferFieldInput,
  type InferFieldOutput,
  type InferTypeInput,
} from "@/types/types";
import { type TailorDBType } from "./schema";

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
  validate?: FieldValidateInput<any>[];
  hooks?: Hook<any, any, any>;
  serial?: SerialConfig;
  relation?: boolean;
}

export type DefinedFieldMetadata = Partial<
  Omit<DBFieldMetadata, "allowedValues"> & { allowedValues: string[] }
>;

type HookFn<TValue, TData, TReturn> = (args: {
  value: TValue;
  data: TData;
  user: TailorUser;
}) => TReturn;

export type Hook<TValue, TData, TReturn> = {
  create?: HookFn<TValue, TData, TReturn>;
  update?: HookFn<TValue, TData, TReturn>;
};

export type Hooks<P extends TailorDBType> = {
  [K in keyof P["fields"] as P["fields"][K]["_defined"] extends {
    hooks: unknown;
  }
    ? never
    : K]?: Hook<
    InferFieldInput<P["fields"][K]>,
    InferTypeInput<P>,
    InferFieldOutput<P["fields"][K]>
  >;
};

export type Validators<P extends TailorDBType> = {
  [K in keyof P["fields"] as P["fields"][K]["_defined"] extends {
    validate: unknown;
  }
    ? never
    : K]?:
    | ValidateFn<InferFieldOutput<P["fields"][K]>, output<P>>
    | ValidateConfig<InferFieldOutput<P["fields"][K]>, output<P>>
    | (
        | ValidateFn<InferFieldOutput<P["fields"][K]>, output<P>>
        | ValidateConfig<InferFieldOutput<P["fields"][K]>, output<P>>
      )[];
};

type ValidateFn<O, D = unknown> = (args: {
  value: O;
  data: D;
  user: TailorUser;
}) => boolean;

export type ValidateConfig<O, D = unknown> = [ValidateFn<O, D>, string];

type FieldValidateFn<O> = ValidateFn<O>;
type FieldValidateConfig<O> = ValidateConfig<O>;
export type FieldValidateInput<O> = FieldValidateFn<O> | FieldValidateConfig<O>;

export type TailorDBServiceConfig = { files: string[] };
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
