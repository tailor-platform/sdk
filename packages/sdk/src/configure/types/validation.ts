import { type TailorUser } from "@/configure/types";

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
