import { type TailorUser } from "@/types";
import {
  type DeepWritable,
  type NullableToOptional,
  type output,
  type Prettify,
} from "@/types/helpers";
import {
  type ArrayFieldOutput,
  type DefinedFieldMetadata,
  type FieldMetadata,
  type FieldOptions,
  type InferFieldsOutput,
} from "@/types/types";
import { type TailorDBField } from "./schema";

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

export interface DefinedDBFieldMetadata extends DefinedFieldMetadata {
  index?: boolean;
  unique?: boolean;
  vector?: boolean;
  foreignKey?: boolean;
  foreignKeyType?: boolean;
  validate?: boolean;
  hooks?: boolean;
  serial?: boolean;
  relation?: boolean;
}

export type ExcludeNestedDBFields<
  T extends Record<string, TailorDBField<any, any, any>>,
> = {
  [K in keyof T]: T[K] extends TailorDBField<
    { type: "nested"; array: boolean },
    any,
    any
  >
    ? never
    : T[K];
};

type HookFn<TValue, TData, TReturn> = (args: {
  value: TValue;
  data: TData;
  user: TailorUser;
}) => TReturn;

export type Hook<TValue, TData, TReturn> = {
  create?: HookFn<TValue, TData, TReturn>;
  update?: HookFn<TValue, TData, TReturn>;
};

// Since empty object type {} would allow any key, return never instead.
type NoEmptyObject<T extends object> = keyof T extends never ? never : T;

export type Hooks<F extends Record<string, TailorDBField<any, any, any>>> =
  NoEmptyObject<{
    [K in Exclude<keyof F, "id"> as F[K]["_defined"] extends {
      hooks: unknown;
    }
      ? never
      : F[K]["_defined"] extends { type: "nested" }
        ? never
        : K]?: Hook<InferFieldInput<F[K]>, InferFieldsInput<F>, output<F[K]>>;
  }>;

export type Validators<F extends Record<string, TailorDBField<any, any, any>>> =
  NoEmptyObject<{
    [K in Exclude<keyof F, "id"> as F[K]["_defined"] extends {
      validate: unknown;
    }
      ? never
      : K]?:
      | ValidateFn<output<F[K]>, InferFieldsOutput<F>>
      | ValidateConfig<output<F[K]>, InferFieldsOutput<F>>
      | (
          | ValidateFn<output<F[K]>, InferFieldsOutput<F>>
          | ValidateConfig<output<F[K]>, InferFieldsOutput<F>>
        )[];
  }>;

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

// Return Input type based on FieldOptions.
// Unlike FieldOutput, it remains nullable even when assertNonNull is set to true.
export type FieldInput<T, O extends FieldOptions> = OptionalFieldInput<
  ArrayFieldOutput<T, O>,
  O
>;

type OptionalFieldInput<T, O extends FieldOptions> = [O] extends [
  {
    optional: true;
  },
]
  ? T | null
  : T;

// Return Input type for TailorDBFields.
type InferFieldsInput<F extends Record<string, TailorDBField<any, any, any>>> =
  DeepWritable<
    Prettify<
      NullableToOptional<{
        [K in keyof F]: InferFieldInput<F[K]>;
      }>
    >
  >;

type InferFieldInput<T extends TailorDBField<any, any, any>> =
  T extends TailorDBField<any, any, infer I> ? I : never;
