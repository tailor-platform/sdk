import { type TailorUser } from "@/configure/types";
import type { InferFieldsOutput, output } from "./helpers";
import type { NonEmptyObject } from "type-fest";

/**
 * Validation function type
 */
export type ValidateFn<O, D = unknown> = (args: {
  value: O;
  data: D;
  user: TailorUser;
}) => boolean;

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
 * Base validators type for field collections
 * @template F - Record of fields
 * @template ExcludeKeys - Keys to exclude from validation (default: "id" for TailorDB)
 */
type ValidatorsBase<
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
  F extends Record<string, { _defined: any; _output: any; [key: string]: any }>,
> = ValidatorsBase<F, "id">;
