import type { output, InferFieldsOutput } from "./helpers";
import type { TailorUser } from "./user";
import type { NonEmptyObject } from "type-fest";

/**
 * Validation function type
 */
export type ValidateFn<O, D = unknown> = (args: { value: O; data: D; user: TailorUser }) => boolean;

/**
 * Validation configuration with custom error message
 */
export type ValidateConfig<O, D = unknown> = [ValidateFn<O, D>, string];

/**
 * Field-level validation function
 */
type FieldValidateFn<O> = ValidateFn<O>;

/**
 * Field-level validation configuration
 */
type FieldValidateConfig<O> = ValidateConfig<O>;

/**
 * Input type for field validation - can be either a function or a tuple of [function, errorMessage]
 */
export type FieldValidateInput<O> = FieldValidateFn<O> | FieldValidateConfig<O>;

/**
 * Record-level validation function.
 * Receives the entire record `data` and returns `true` if valid.
 */
export type RecordValidateFn<TData> = (args: { data: TData; user: TailorUser }) => boolean;

/**
 * Record-level validation configuration with a custom error message.
 */
export type RecordValidateConfig<TData> = [RecordValidateFn<TData>, string];

/**
 * Single record-level validation input: either a function or `[function, message]` tuple.
 */
export type RecordValidateInput<TData> = RecordValidateFn<TData> | RecordValidateConfig<TData>;

/**
 * Record-level validators: single input or an array of inputs.
 */
export type RecordValidators<TData> = RecordValidateInput<TData> | RecordValidateInput<TData>[];

/**
 * Base validators type for field collections
 * @template F - Record of fields
 * @template ExcludeKeys - Keys to exclude from validation (default: "id" for TailorDB)
 */
type ValidatorsBase<
  // Structural constraint only
  // oxlint-disable-next-line no-explicit-any
  F extends Record<string, { _defined: any; _output: any; [key: string]: any }>,
  ExcludeKeys extends string = "id",
> = NonEmptyObject<{
  [K in Exclude<keyof F, ExcludeKeys> as F[K]["_defined"] extends {
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

/**
 * Validators type (by default excludes "id" field for TailorDB compatibility)
 * Can be used with both TailorField and TailorDBField
 */
export type Validators<
  // Structural constraint only
  // oxlint-disable-next-line no-explicit-any
  F extends Record<string, { _defined: any; _output: any; [key: string]: any }>,
> = ValidatorsBase<F, "id">;
