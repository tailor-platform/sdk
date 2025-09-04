import { TailorUser } from "@/types";
import { output, Prettify } from "@/types/helpers";
import {
  FieldMetadata,
  InferFieldInput,
  InferFieldOutput,
  InferTypeInput,
} from "@/types/types";
import { TailorDBType } from "./schema";

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

type DBTypeLike = {
  fields: Record<string, { _defined: Record<string, unknown> }>;
};
type DefinedFields<
  T extends DBTypeLike,
  K extends keyof DBFieldMetadata,
> = keyof {
  [P in keyof T["fields"] as T["fields"][P]["_defined"] extends {
    [Key in K]: unknown;
  }
    ? P
    : never]: keyof T["fields"][P]["_defined"];
};

type UndefinedFields<
  T extends DBTypeLike,
  K extends keyof DBFieldMetadata,
> = Exclude<keyof T["fields"], DefinedFields<T, K>>;

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

export type Validators<P extends DBTypeLike> = {
  [K in UndefinedFields<P, "validate">]?: K extends keyof output<P>
    ?
        | ValidateFn<output<P>[K], output<P>>
        | ValidateConfig<output<P>[K], output<P>>
        | (
            | ValidateFn<output<P>[K], output<P>>
            | ValidateConfig<output<P>[K], output<P>>
          )[]
    : never;
} & {
  [K in DefinedFields<P, "validate">]?: {
    "validator already defined in field": never;
  };
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
