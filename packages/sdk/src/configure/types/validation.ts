import { type TailorUser } from "@/configure/types";
import type { output } from "./helpers";
import type { NonEmptyObject } from "type-fest";

/**
 * Validation function type
 */
export type ValidateFn<O> = (args: { value: O; user: TailorUser }) => boolean;

/**
 * Validation configuration with custom error message
 */
export type ValidateConfig<O> = [ValidateFn<O>, string];

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
    | ValidateFn<output<F[K]>>
    | ValidateConfig<output<F[K]>>
    | (ValidateFn<output<F[K]>> | ValidateConfig<output<F[K]>>)[];
}>;

/**
 * Validators type (by default excludes "id" field for TailorDB compatibility)
 * Can be used with both TailorField and TailorDBField
 */
export type Validators<
  F extends Record<string, { _defined: any; _output: any; [key: string]: any }>,
> = ValidatorsBase<F, "id">;
