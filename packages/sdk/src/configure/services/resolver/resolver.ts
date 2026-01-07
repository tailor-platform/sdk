import { t, TailorField } from "@/configure/types/type";
import type { TailorAnyField, TailorUser } from "@/configure/types";
import type { TailorEnv } from "@/configure/types/env";
import type { InferFieldsOutput, output } from "@/configure/types/helpers";
import type { ResolverInput } from "@/parser/service/resolver/types";

type Context<Input extends Record<string, TailorAnyField> | undefined> = {
  input: Input extends Record<string, TailorAnyField> ? InferFieldsOutput<Input> : never;
  user: TailorUser;
  env: TailorEnv;
};

type OutputType<O> = O extends TailorAnyField
  ? output<O>
  : O extends Record<string, TailorAnyField>
    ? InferFieldsOutput<O>
    : never;

/**
 * Normalized output type that preserves generic type information.
 * - If Output is already a TailorField, use it as-is
 * - If Output is a Record of fields, wrap it as a nested TailorField
 */
type NormalizedOutput<Output extends TailorAnyField | Record<string, TailorAnyField>> =
  Output extends TailorAnyField
    ? Output
    : TailorField<
        { type: "nested"; array: false },
        InferFieldsOutput<Extract<Output, Record<string, TailorAnyField>>>
      >;

type ResolverReturn<
  Input extends Record<string, TailorAnyField> | undefined,
  Output extends TailorAnyField | Record<string, TailorAnyField>,
> = Omit<ResolverInput, "input" | "output" | "body"> &
  Readonly<{
    input?: Input;
    output: NormalizedOutput<Output>;
    body: (context: Context<Input>) => OutputType<Output> | Promise<OutputType<Output>>;
  }>;

export function createResolver<
  Input extends Record<string, TailorAnyField> | undefined = undefined,
  Output extends TailorAnyField | Record<string, TailorAnyField> = TailorAnyField,
>(
  config: Omit<ResolverInput, "input" | "output" | "body"> &
    Readonly<{
      input?: Input;
      output: Output;
      body: (context: Context<Input>) => OutputType<Output> | Promise<OutputType<Output>>;
    }>,
): ResolverReturn<Input, Output> {
  const normalizedOutput =
    config.output instanceof TailorField ? config.output : t.object(config.output);

  return {
    ...config,
    output: normalizedOutput,
  } as ResolverReturn<Input, Output>;
}

export type ResolverConfig = ReturnType<typeof createResolver<any, any>>;
